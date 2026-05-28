"""Inbox-mined job application tracker.

Reads ademolaomosanya@gmail.com via IMAP (using the existing Gmail App
Password in SMTP_PASS), classifies messages into application / interview /
rejection events, reconciles them against the existing `jobs` Firestore
collection, and writes a timeline to a new `application_events` collection.

Entry point: scripts/run_inbox_tracker.py.
"""

from __future__ import annotations

import email
import email.utils
import hashlib
import imaplib
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.header import decode_header
from typing import Dict, List, Optional, Tuple

from . import config
from .firestore import init_firestore_client
from .llm import generate_openrouter_text, parse_gemini_payload


# ---------- Detection vocabularies ----------

ATS_SENDER_DOMAINS = [
    "linkedin.com",
    "greenhouse.io",
    "lever.co",
    "myworkdayjobs.com",
    "workday.com",
    "myworkday.com",
    "ashbyhq.com",
    "ashby.com",
    "smartrecruiters.com",
    "workable.com",
    "taleo.net",
    "icims.com",
    "eightfold.ai",
    "bamboohr.com",
    "recruitee.com",
    "teamtailor.com",
    "personio.com",
    "personio.de",
    "jobscore.com",
    "breezy.hr",
    "jazzhr.com",
    "jobserve.com",
    "indeed.com",
    "hire.lever.co",
    "boards.greenhouse.io",
    "jobs.lever.co",
    "successfactors.com",
    "oraclecloud.com",
]

SUBJECT_APPLICATION_HINTS = [
    "thank you for applying",
    "thanks for applying",
    "thank you for your application",
    "thanks for your application",
    "we received your application",
    "we have received your application",
    "your application has been received",
    "your application was sent",
    "application received",
    "application submitted",
    "application confirmation",
    "we've received your application",
    "submission received",
    "applying with",
]

SUBJECT_INTERVIEW_HINTS = [
    "interview",
    "next steps",
    "next step",
    "phone screen",
    "screening call",
    "schedule a call",
    "schedule a chat",
    "schedule a time",
    "calendly",
    "would love to chat",
    "let's chat",
    "let's connect",
    "available for a chat",
    "available to chat",
    "moving forward",
    "would like to invite",
    "invite you to",
    "video call",
    "would you be available",
]

SUBJECT_REJECTION_HINTS = [
    "unfortunately",
    "not moving forward",
    "not progressing",
    "not be moving forward",
    "decided to move forward with other candidates",
    "decided not to proceed",
    "regret to inform",
    "we have decided",
    "filled the role",
    "filled this role",
    "no longer being considered",
    "not selected",
    "thank you for your interest",  # ambiguous, LLM will disambiguate
    "update on your application",
]

# Subject keywords that, on their own, force an LLM classification (no rule hit)
AMBIGUOUS_KEYWORDS = [
    "application",
    "interview",
    "role",
    "position",
    "opportunity",
    "candidate",
]

# Hard noise denylist — survey / feedback / referral / digest emails that
# look application-related but are not actual events. These force `noise`
# regardless of other signals.
NOISE_SUBJECT_PATTERNS = [
    "how did we do",
    "rate your interview",
    "rate your experience",
    "your feedback on",
    "share your feedback",
    "we'd love your feedback",
    "tell us about your interview",
    "candidate experience survey",
    "interview feedback survey",
    "post-interview survey",
    "survey",
    "referral",
    "job alert",
    "jobs for you",
    "new jobs that match",
    "weekly digest",
    "daily digest",
    "career insights",
    "unsubscribe",
]

NOISE_SENDER_PATTERNS = [
    "feedback@",
    "surveys@",
    "noreply-feedback@",
    "notifications@linkedin.com",  # job alerts, not application mail
    "jobs-noreply@linkedin.com",
    "talent-insights@",
]

# Known company-name aliases — collapse variants to a canonical key for
# reconciliation. Both sides are pre-normalised (lowercase, no suffixes).
COMPANY_ALIASES: Dict[str, str] = {
    "jpmorgan": "jpmorgan chase",
    "jp morgan": "jpmorgan chase",
    "chase": "jpmorgan chase",
    "jpmc": "jpmorgan chase",
    "j p morgan": "jpmorgan chase",
    "rbccm": "rbc",
    "rbc capital markets": "rbc",
    "rbc capital markets london": "rbc",
    "royal bank of canada": "rbc",
    "natwest": "natwest group",
    "checkout": "checkout.com",
    "wise payments": "wise",
    "wise plc": "wise",
}

# Senders whose mail is recruiter outreach masquerading as interview language.
# Demote interview_invite to lower confidence unless body has hard signals.
RECRUITER_SENDER_HINTS = [
    "recruiter",
    "talent acquisition",
    "talent partner",
    "recruiting",
    "sourcer",
]


# ---------- Data shapes ----------

@dataclass
class Event:
    message_id: str
    received_at: str           # ISO 8601 UTC
    event_type: str            # application_confirmation | interview_invite | rejection | noise
    confidence: float          # 0.0-1.0
    company: str
    role: str
    job_url: str
    ats_family: str
    sender: str
    subject_redacted: str
    detection_source: str      # "rules" | "llm"
    matched_job_id: str = ""
    match_status: str = "no_match"   # matched | ambiguous | no_match | new_doc
    candidate_doc_ids: List[str] = field(default_factory=list)
    body_snippet: str = ""      # first 400 chars of plaintext body (debug)


@dataclass
class RunResult:
    started_at: str
    finished_at: str
    since: str
    candidates_fetched: int
    events: List[Event]
    notes: List[str]
    firestore_writes: Dict[str, int]


# ---------- IMAP helpers ----------

def _decode(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="replace")
        except Exception:
            return value.decode("latin-1", errors="replace")
    parts = decode_header(value)
    out = []
    for chunk, enc in parts:
        if isinstance(chunk, bytes):
            try:
                out.append(chunk.decode(enc or "utf-8", errors="replace"))
            except Exception:
                out.append(chunk.decode("latin-1", errors="replace"))
        else:
            out.append(chunk)
    return "".join(out).strip()


def _find_all_mail_folder(imap: imaplib.IMAP4_SSL) -> str:
    """Return the quoted folder name for All Mail (locale-aware)."""
    typ, data = imap.list()
    if typ != "OK":
        return '"[Gmail]/All Mail"'
    candidates = []
    for raw in data or []:
        line = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
        if "\\All" in line:
            m = re.search(r'"([^"]+)"\s*$', line)
            if m:
                candidates.append(m.group(1))
    if candidates:
        return f'"{candidates[0]}"'
    return '"[Gmail]/All Mail"'


def _x_gm_search(imap: imaplib.IMAP4_SSL, raw_query: str) -> List[bytes]:
    """Execute a Gmail X-GM-RAW search and return list of UID bytes."""
    # IMAP requires the literal-syntax-friendly form. Send as a quoted string
    # since our queries fit in well under the 2KB line limit.
    quoted = '"' + raw_query.replace("\\", "\\\\").replace('"', '\\"') + '"'
    typ, data = imap.uid("SEARCH", "X-GM-RAW", quoted)
    if typ != "OK" or not data:
        return []
    uids: List[bytes] = []
    for chunk in data:
        if not chunk:
            continue
        if isinstance(chunk, bytes):
            uids.extend(chunk.split())
        else:
            uids.extend(str(chunk).encode().split())
    return uids


def _build_search_batches(since_yyyy_mm_dd: str) -> List[str]:
    """Return a list of X-GM-RAW queries that together cover all candidate mail.

    Each query stays well under Gmail's 2KB limit. We OR-group ATS senders into
    one bucket and OR-group subject phrases into a second bucket.
    """
    after = since_yyyy_mm_dd.replace("-", "/")

    sender_or = " OR ".join(f"from:{d}" for d in ATS_SENDER_DOMAINS)
    sender_q = f"({sender_or}) -from:me after:{after}"

    subjects = SUBJECT_APPLICATION_HINTS + SUBJECT_INTERVIEW_HINTS + SUBJECT_REJECTION_HINTS
    subj_or = " OR ".join(f'subject:"{s}"' for s in subjects)
    subj_q = f"({subj_or}) -from:me after:{after}"

    return [sender_q, subj_q]


def _fetch_headers(imap: imaplib.IMAP4_SSL, uids: List[bytes]) -> Dict[bytes, Dict[str, str]]:
    """Fetch headers (cheap) for triage. Returns {uid: {field: value}}."""
    if not uids:
        return {}
    # Batch UID FETCH in chunks of 200 to keep responses manageable
    out: Dict[bytes, Dict[str, str]] = {}
    chunks = [uids[i:i + 200] for i in range(0, len(uids), 200)]
    for batch in chunks:
        uid_set = b",".join(batch)
        typ, data = imap.uid(
            "FETCH",
            uid_set,
            "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID TO REPLY-TO)])",
        )
        if typ != "OK" or not data:
            continue
        # data is a list of tuples like (b'1 (UID 123 BODY[HEADER...] {N}', b'<headers>') interleaved with b')'
        current_uid: Optional[bytes] = None
        for item in data:
            if isinstance(item, tuple) and len(item) == 2:
                meta, body = item
                m = re.search(rb"UID (\d+)", meta or b"")
                if m:
                    current_uid = m.group(1)
                try:
                    msg = email.message_from_bytes(body)
                    headers = {
                        "from": _decode(msg.get("From", "")),
                        "subject": _decode(msg.get("Subject", "")),
                        "date": _decode(msg.get("Date", "")),
                        "message_id": _decode(msg.get("Message-ID", "")),
                        "to": _decode(msg.get("To", "")),
                        "reply_to": _decode(msg.get("Reply-To", "")),
                    }
                    if current_uid:
                        out[current_uid] = headers
                except Exception:
                    continue
    return out


def _strip_html(html: str) -> str:
    """Strip HTML to plain text, removing style/script/head content first.

    The previous implementation kept inlined <style> CSS in the output, which
    poisoned the first few hundred chars of bodies from Workday-style ATS
    senders (Barclays, NatWest) and broke role extraction.
    """
    if not html:
        return ""
    h = html
    # Drop style, script, head — these never carry user-visible content
    for tag in ("style", "script", "head"):
        h = re.sub(rf"<{tag}\b[^>]*>.*?</{tag}>", " ", h, flags=re.IGNORECASE | re.DOTALL)
    # Drop HTML comments (often contain CSS or tracking pixels)
    h = re.sub(r"<!--.*?-->", " ", h, flags=re.DOTALL)
    # Replace <br>, <p>, </p>, </tr>, </td> with newlines so paragraphs survive
    h = re.sub(r"<(br|/p|/tr|/td|/li|/h\d)[^>]*>", "\n", h, flags=re.IGNORECASE)
    # Strip the rest of the tags
    h = re.sub(r"<[^>]+>", " ", h)
    # HTML entity decode (cheap)
    h = (h.replace("&nbsp;", " ")
           .replace("&amp;", "&")
           .replace("&#39;", "'")
           .replace("&rsquo;", "'")
           .replace("&lsquo;", "'")
           .replace("&ldquo;", '"')
           .replace("&rdquo;", '"')
           .replace("&mdash;", "—")
           .replace("&ndash;", "–"))
    # Collapse whitespace, but keep newlines for paragraph boundaries
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r"\n[ \t]*\n+", "\n\n", h)
    return h.strip()


def _fetch_body_text(imap: imaplib.IMAP4_SSL, uid: bytes) -> str:
    """Fetch plain-text body for one UID. Falls back to stripping HTML."""
    typ, data = imap.uid("FETCH", uid, "(BODY.PEEK[])")
    if typ != "OK" or not data:
        return ""
    for item in data:
        if isinstance(item, tuple) and len(item) == 2 and item[1]:
            try:
                msg = email.message_from_bytes(item[1])
            except Exception:
                continue
            text = ""
            html = ""
            if msg.is_multipart():
                for part in msg.walk():
                    ct = part.get_content_type()
                    if ct == "text/plain" and not text:
                        try:
                            text = part.get_payload(decode=True).decode(
                                part.get_content_charset() or "utf-8", errors="replace"
                            )
                        except Exception:
                            continue
                    elif ct == "text/html" and not html:
                        try:
                            html = part.get_payload(decode=True).decode(
                                part.get_content_charset() or "utf-8", errors="replace"
                            )
                        except Exception:
                            continue
            else:
                ct = msg.get_content_type()
                try:
                    decoded = msg.get_payload(decode=True)
                    if decoded:
                        decoded_text = decoded.decode(
                            msg.get_content_charset() or "utf-8", errors="replace"
                        )
                        if ct == "text/html":
                            html = decoded_text
                        else:
                            text = decoded_text
                except Exception:
                    pass
            # Prefer text/plain when it has real content; otherwise strip HTML
            if text and len(text.strip()) > 40:
                return text[:20000]
            if html:
                stripped = _strip_html(html)
                if stripped:
                    return stripped[:20000]
            if text:
                return text[:20000]
    return ""


# ---------- Classification ----------

def _sender_domain(sender_field: str) -> str:
    m = re.search(r"[\w.-]+@([\w.-]+)", sender_field or "")
    return (m.group(1).lower() if m else "")


def _ats_family_from_domain(domain: str) -> str:
    if not domain:
        return ""
    d = domain.lower()
    for key, label in [
        ("greenhouse", "greenhouse"),
        ("lever", "lever"),
        ("workday", "workday"),
        ("myworkday", "workday"),
        ("ashby", "ashby"),
        ("smartrecruiters", "smartrecruiters"),
        ("workable", "workable"),
        ("taleo", "taleo"),
        ("icims", "icims"),
        ("eightfold", "eightfold"),
        ("bamboohr", "bamboohr"),
        ("recruitee", "recruitee"),
        ("teamtailor", "teamtailor"),
        ("personio", "personio"),
        ("jobscore", "jobscore"),
        ("breezy", "breezy"),
        ("jazzhr", "jazzhr"),
        ("jobserve", "jobserve"),
        ("linkedin", "linkedin"),
        ("indeed", "indeed"),
        ("oraclecloud", "oracle_hcm"),
        ("successfactors", "successfactors"),
    ]:
        if key in d:
            return label
    return ""


def _is_noise(subject: str, sender: str) -> bool:
    """Hard denylist for surveys, job alerts, digests etc."""
    s = (subject or "").lower()
    snd = (sender or "").lower()
    if any(p in s for p in NOISE_SUBJECT_PATTERNS):
        return True
    if any(p in snd for p in NOISE_SENDER_PATTERNS):
        return True
    return False


def _classify_by_rules(subject: str, body: str, sender: str = "") -> Tuple[str, float]:
    """Rules-only classification. Returns (event_type, confidence)."""
    s = (subject or "").lower()
    b = (body or "").lower()[:6000]

    # Hard noise filter — overrides everything else
    if _is_noise(subject, sender):
        return "noise", 0.0

    def hit(phrases, text):
        return any(p in text for p in phrases)

    # Rejection signals first (often co-occur with "application" wording)
    rejection_signals = [
        "we have decided not to",
        "not moving forward",
        "not be moving forward",
        "regret to inform",
        "decided to move forward with other candidates",
        "have decided not to proceed",
        "no longer being considered",
        "not selected for the role",
        "filled the position",
        "filled this role",
        "we will not be progressing",
        "after careful consideration",
        "wish you the best in your future",
        "wish you success in your job search",
        "has not been progressed",
        "not been progressed",
        "application has not been successful",
        "will not be progressing your application",
    ]
    if hit(rejection_signals, b) or hit(["unfortunately", "regret to inform", "not moving forward", "update on your application"], s):
        return "rejection", 0.85

    # Application confirmation signals — check BEFORE interview since
    # confirmation emails often contain "next steps" phrasing in the body
    # ("we'll be in touch about next steps") which would trip the interview
    # classifier otherwise.
    application_subject_strong = [
        "thank you for applying", "thanks for applying", "thank you for your application",
        "thanks for your application", "application received", "application submitted",
        "we received your application", "have received your application",
        "your application has been received", "your application was sent",
        "application confirmation", "we've received your application",
        "successfully applied",
        # SuccessFactors agency-pass template: "Candidate details provided by an Agency"
        "candidate details provided by an agency",
    ]
    application_body_strong = [
        "thank you for applying", "thank you for your application",
        "we have received your application", "we received your application",
        "your application has been received", "successfully submitted",
        "your application was sent", "we've received your application",
        # Agency-pass language used by SuccessFactors / Workday on behalf-of mails
        "your details have been passed to us",
        "details have been passed to us by",
        "in application for the position of",
    ]
    if hit(application_subject_strong, s) or hit(application_body_strong, b):
        return "application_confirmation", 0.92

    # Interview / next-step signals — require STRONG body signal to fire,
    # not just "interview" anywhere in subject (which could be an interview
    # PREP email, calendar reminder for a survey, etc.)
    interview_strong_body = [
        "schedule a time", "schedule a call", "calendly.com", "would you be available",
        "invite you to interview", "phone screen", "screening call", "next stage",
        "we'd love to chat", "would love to chat", "video call",
        "first stage interview", "second stage interview", "final stage",
        "available to meet", "available for a call", "available for a chat",
        "interview invitation",
    ]
    interview_strong_subject = [
        "interview invitation", "invitation to interview", "interview confirmed",
        "interview scheduled", "interview with",
    ]
    if hit(interview_strong_subject, s) or hit(interview_strong_body, b):
        # If sender clearly recruiter outreach without ATS hints, downgrade
        if any(p in sender.lower() for p in RECRUITER_SENDER_HINTS) and "interview" not in s:
            return "noise", 0.0
        return "interview_invite", 0.9

    return "noise", 0.0


def _extract_job_url(body: str) -> str:
    """Pull the first plausible job-posting URL from the body."""
    if not body:
        return ""
    urls = re.findall(r"https?://[^\s)>\]\"']+", body)
    for url in urls:
        u = url.lower()
        for marker in (
            "/jobs/", "/job/", "/careers/", "/career/", "/openings/",
            "linkedin.com/jobs/view/", "greenhouse.io/", "lever.co/",
            "myworkdayjobs.com", "ashbyhq.com", "smartrecruiters.com/",
            "workable.com/", "icims.com/", "taleo.net", "oraclecloud.com",
            "jobserve.com/", "successfactors.com",
        ):
            if marker in u:
                return url.rstrip(".,);'\"")
    return ""


_STOP_WORDS = {
    "has", "have", "was", "is", "for", "at", "with", "your", "the", "an", "a",
    "to", "received", "received.", "submitted", "submitted.", "successful",
    "confirmed", "review", "and", "or", "of", "on", "we", "you", "are",
    "been", "team", "regarding", "update", "application", "thank", "thanks",
}


def _clean_token_tail(text: str) -> str:
    """Trim trailing stop-words / punctuation from a candidate company string.

    Also split on sentence boundaries ("Lendable. Unfortunately" -> "Lendable")
    while preserving inside-token periods like "Checkout.com".
    """
    cleaned = re.sub(r"\s+", " ", (text or "")).strip(" -—|:;.,!?")
    # Split on ". <Capital>" (sentence boundary) — keep first chunk only
    cleaned = re.split(r"\.\s+(?=[A-Z])", cleaned)[0]
    # Drop trailing stop-words ("Hawk has been received" -> "Hawk")
    parts = cleaned.split(" ")
    while parts and parts[-1].lower().strip(".,;:!?") in _STOP_WORDS:
        parts.pop()
    return " ".join(parts).strip(" -—|:;.,!?")


def _extract_company_role(subject: str, body: str, sender: str) -> Tuple[str, str]:
    """Best-effort company + role extraction from subject, body, sender."""
    s = subject or ""
    company = ""
    role = ""

    # 0) JobServe agency confirmations have empty bodies; the subject carries a
    # job code like "JS117867" or "JSPRODUCT ANALYST". Role text after JS- /
    # JS<digits> is the recoverable signal. Company stays "JobServe (recruiter)".
    if "jobserve.com" in (sender or "").lower() and "application confirmation" in s.lower():
        m_js = re.search(r"\bJS[-_ ]?([A-Z0-9 \-]+)$", s)
        if m_js:
            candidate = m_js.group(1).strip(" -_")
            # If it's pure digits it's just a job-ID; leave role empty
            if not candidate.isdigit():
                role = candidate.title()
        return "JobServe (recruiter)", role

    # 0b) Strip "join " when subject is "Thank you for your application to join X"
    s_clean = re.sub(r"\bto\s+join\s+", "to ", s, flags=re.IGNORECASE)
    s = s_clean

    # 0b2) PrecisePlace / Precise Placements agency emails: the firm is in the
    # body via "<Role> with <Company>" / "for <Company>". Reattribute.
    sender_lower = (sender or "").lower()
    if "preciseplace" in sender_lower or "precise placements" in (body or "").lower()[:1500]:
        b1 = (body or "")[:3000]
        m_pp = re.search(
            r"(?:role|position|opportunity|opening)\s+(?:of|with|at)\s+(?:the\s+)?(?:[\w '&.\-]{1,80}?\s+)?(?:with|at|for)\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            b1,
        )
        if m_pp:
            company = m_pp.group(1).strip()
        if not company:
            m_with = re.search(r"\bwith\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,3})\s+(?:Global|Group|Limited|Ltd|UK)?", b1)
            if m_with:
                company = m_with.group(1).strip()

    # 0c) "Interview for <Role> job at <Company>" (Workable reminder) and
    # "Interview with <Company>" / "Reminder: Your Upcoming Interview with <Company>"
    m_jat = re.search(r"(?:interview|reminder)[^|]{0,40}for\s+(.+?)\s+(?:job|role|position)\s+at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})", s, re.IGNORECASE)
    if m_jat:
        role = role or m_jat.group(1).strip()
        company = company or m_jat.group(2).strip()
    if not company:
        m_with = re.search(r"interview\s+with\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})", s, re.IGNORECASE)
        if m_with:
            company = m_with.group(1).strip()
    if not company:
        m_rem = re.search(r"reminder[: ]+your upcoming interview with\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})", s, re.IGNORECASE)
        if m_rem:
            company = m_rem.group(1).strip()

    # 1) Strong subject patterns — bounded, NOT greedy.
    # "Your application for <Role> at <Company>" / "...has been received"
    m = re.search(
        r"application (?:for|to)\s+(.+?)\s+at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
        s, re.IGNORECASE,
    )
    if m:
        role = role or m.group(1).strip()
        company = company or m.group(2).strip()

    # "<Role> at <Company> — has been received" style
    if not company:
        m2 = re.search(
            r"^([A-Z][^|:—\-]{2,80})\s+at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            s,
        )
        if m2:
            role = role or m2.group(1).strip()
            company = m2.group(2).strip()

    # "Your application to <Company> ..." — company is single proper-noun phrase
    if not company:
        m3 = re.search(
            r"(?:application (?:to|with)|applying (?:to|with))\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            s, re.IGNORECASE,
        )
        if m3:
            company = m3.group(1).strip()

    # LinkedIn: "Your application was sent to <Company>"
    if not company:
        m4 = re.search(r"your application was sent to\s+(.+?)(?:[:\-—|]|$)", s, re.IGNORECASE)
        if m4:
            company = m4.group(1).strip()

    # "Update on your application for <Role>" / "Update on your application" (rejection)
    if not role:
        m5 = re.search(r"application for\s+(.+?)(?:\s+at\s+|[:\-—|]|$)", s, re.IGNORECASE)
        if m5:
            role = m5.group(1).strip()

    # 1c) Agency-pass via SuccessFactors / Workday:
    #     "in application for the position of <Role> with <Company>"
    if not role or not company:
        b = body[:4000] if body else ""
        m_pos = re.search(
            r"in application for the position of\s+(.+?)\s+with\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            b, re.IGNORECASE,
        )
        if m_pos:
            if not role:
                role = m_pos.group(1).strip()
            if not company:
                company = m_pos.group(2).strip()

    # 2) Body fallback for role — many ATS bodies have structured fields.
    # Stop role extraction at sentence boundaries and HTML/link junk; reject
    # results that are clearly sentence fragments ("we have good development
    # support from the other te...").
    if not role and body:
        b = body[:4000]
        for pattern in (
            r"\b(?:Position|Role|Job title|Job)\s*[:\-]\s*([^.\n\r<]{3,120})",
            r"\bapplied (?:for|to) the\s+([^.\n\r<]{3,120}?)\s+(?:position|role|opportunity|opening)",
            r"\bapplication (?:for|to)\s+the\s+([^.\n\r<]{3,120}?)\s+(?:position|role|opportunity|opening)",
            r"\bthank you for applying (?:to|for) the\s+([^.\n\r<]{3,120}?)\s+(?:position|role|opportunity|opening)",
            r"\byour application (?:for|to) (?:the )?([^.\n\r<]{3,120}?)\s+(?:position|role|opportunity|opening|at)",
            r"\bfor the\s+([A-Z][^.\n\r<]{3,120}?)\s+(?:position|role|opportunity|opening)",
            r"<title>([^<]{3,120})</title>",  # last-resort: HTML <title>
        ):
            m6 = re.search(pattern, b, re.IGNORECASE)
            if m6:
                candidate = m6.group(1).strip()
                # Reject candidates that look like sentence fragments
                # (start with a lowercase word, or contain typical filler)
                first_word = candidate.split(" ", 1)[0]
                if (first_word[:1].islower() and first_word.lower() not in {"senior", "junior", "lead", "head"}) or \
                        any(b in candidate.lower() for b in (" we ", " they ", " our ", " from the ", " support from")):
                    continue
                role = candidate
                break

    # 3) Body fallback for company — structured fields or "at <Company>"
    if not company and body:
        b = body[:4000]
        for pattern in (
            r"\b(?:Company|Employer|Organization|Organisation)\s*[:\-]\s*([^\n\r<]{2,80})",
            r"applied (?:for|to) [^.<\n]{3,120} at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"position at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"role at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"team at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"opportunity at\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
        ):
            m7 = re.search(pattern, b)
            if m7:
                company = m7.group(1).strip()
                break

    # 3b) Greenhouse/Workday body fallback: "applying for/to <Company>" / "interest in <Company>"
    if not company and body:
        b = body[:6000]
        for pattern in (
            r"interest in\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"appreciate your interest in\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"applying (?:to|for) (?:the |a |an )?[\w &'.\-]{0,80}?(?:role|position|opportunity|opening|job)\s+(?:at|with)\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"applied (?:to|for)\s+(?:the |a |an )?[\w &'.\-]{0,80}?(?:role|position|opportunity|opening|job)\s+(?:at|with)\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"applying (?:to|for)\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"Dear[\w \-,]{1,40}Thank you for applying to\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
            r"Thank you for applying to\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,4})",
        ):
            m_b = re.search(pattern, b)
            if m_b:
                candidate = m_b.group(1).strip()
                # Reject obvious noise tokens
                if candidate.lower() not in {"the", "our", "us", "this", "your"}:
                    company = candidate
                    break

    # 4) ATS sender-domain hint as last resort. Greenhouse/Lever encode
    # tenant in subdomain (e.g. boards-mail.greenhouse.io / wise.greenhouse.io).
    if not company:
        domain = _sender_domain(sender)
        if domain:
            for ats in ("greenhouse-mail.io", "greenhouse.io", "lever.co",
                        "ashbyhq.com", "smartrecruiters.com",
                        "workable.com", "myworkdayjobs.com", "myworkday.com",
                        "recruitee.com", "teamtailor.com", "personio.com",
                        "personio.de"):
                if domain.endswith(ats):
                    sub = domain[: -(len(ats) + 1)]
                    # boards-mail / talent / careers / region-codes etc. are not company names
                    candidates = [p for p in sub.split(".") if p and p not in {
                        "boards", "boards-mail", "talent", "careers", "jobs",
                        "hire", "apply", "no-reply", "noreply", "mail",
                        "eu", "us", "uk", "emea", "amer", "apac",  # region codes
                    }]
                    if candidates:
                        company = candidates[-1].replace("-", " ").title()
                        break
            # Workable's inbound.workablemail.com is generic transport — never
            # use "inbound" as a company name; the real company is in the body.
            if domain.endswith("workablemail.com") or "inbound" in domain.split(".")[:1]:
                # Try one more body pattern: "at <Company>" near the end
                if body:
                    m_at = re.search(r"\bat\s+([A-Z][\w&'.\-]+(?:\s+[A-Z][\w&'.\-]+){0,3})\b", body[:2000])
                    if m_at:
                        company = m_at.group(1).strip()
            # generic corporate domain fallback (e.g. careers@monzo.com)
            if not company and not any(ats in domain for ats in ATS_SENDER_DOMAINS):
                base = domain.split(".")[0]
                if base not in {"mail", "no-reply", "noreply", "donotreply",
                                "do-not-reply", "do_not_reply", "info", "hello",
                                "inbound", "outbound", "system", "notifications"}:
                    company = base.title()

    # 5) Cleanup — drop trailing stop-words and length-cap
    company = _clean_token_tail(company)[:80]
    role = _clean_token_tail(role)[:120]
    return company, role


def _llm_classify(subject: str, body: str, sender: str) -> Optional[Dict[str, object]]:
    """Use the OpenRouter (DeepSeek) model to classify an ambiguous email."""
    prompt = (
        "Classify this email about a job application. Return JSON ONLY with keys:\n"
        '  event_type: one of "application_confirmation", "interview_invite", "rejection", "noise"\n'
        "  confidence: float 0.0-1.0\n"
        "  company: string (best guess of the employer; empty if unclear)\n"
        "  role: string (best guess of the job title; empty if unclear)\n\n"
        "Be conservative: prefer 'noise' over guessing. A job alert / digest / recommendation is 'noise'.\n"
        f"From: {sender}\n"
        f"Subject: {subject}\n"
        "Body (truncated):\n"
        f"{(body or '')[:2500]}\n"
    )
    text = generate_openrouter_text(prompt)
    if not text:
        return None
    data = parse_gemini_payload(text)
    if not data:
        return None
    try:
        et = str(data.get("event_type", "noise")).strip().lower()
        if et not in {"application_confirmation", "interview_invite", "rejection", "noise"}:
            et = "noise"
        conf = float(data.get("confidence", 0.0))
        return {
            "event_type": et,
            "confidence": max(0.0, min(1.0, conf)),
            "company": str(data.get("company", "")).strip()[:80],
            "role": str(data.get("role", "")).strip()[:120],
        }
    except (TypeError, ValueError):
        return None


def _should_call_llm(
    rule_type: str,
    rule_conf: float,
    subject: str,
    body: str,
    company: str,
    role: str,
) -> bool:
    """Decide if LLM fallback should run. Aim for high recall, low spam."""
    # If rules are confident but parser failed to extract company/role for
    # a high-value event, call the LLM so we can populate those fields.
    needs_extraction = rule_type in {"application_confirmation", "rejection"} and (not company or not role)
    if needs_extraction:
        return True
    if rule_type != "noise" and rule_conf >= 0.9:
        return False
    s = (subject or "").lower()
    b = (body or "").lower()[:2000]
    if any(k in s or k in b for k in AMBIGUOUS_KEYWORDS):
        return True
    return False


# ---------- Reconciliation against existing jobs ----------

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokens(text: str) -> set:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if len(t) > 2}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(1, len(a | b))


def _norm_company(c: str) -> str:
    s = (c or "").lower()
    s = re.sub(r"\b(ltd|limited|inc|llc|plc|gmbh|ag|bv|nv|sa|sas|group|holdings|holding|global|international|the)\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return COMPANY_ALIASES.get(s, s)


def _load_jobs_index(client) -> List[Dict[str, object]]:
    """Pull a minimal index from Firestore: {id, company, role, link,
    application_status, application_date}."""
    rows: List[Dict[str, object]] = []
    if client is None:
        return rows
    try:
        for snap in client.collection(config.FIREBASE_COLLECTION).stream():
            d = snap.to_dict() or {}
            rows.append({
                "id": snap.id,
                "company": d.get("company") or "",
                "role": d.get("role") or "",
                "link": d.get("link") or "",
                "application_status": (d.get("application_status") or "").lower(),
                "application_date": d.get("application_date") or "",
            })
    except Exception as exc:
        print(f"Job index load failed: {exc}", file=sys.stderr)
    return rows


def _reconcile_jobserve_by_date(event: Event, jobs_index: List[Dict[str, object]]) -> bool:
    """JobServe confirmations have empty bodies — the actual hiring firm is in
    the JobServe portal, not the email. Recover by matching against Firestore
    `applied` docs with application_date within ±1 day of the event.

    Returns True if a match was set on the event.
    """
    if "jobserve" not in (event.sender or "").lower():
        return False
    if event.event_type != "application_confirmation":
        return False
    try:
        ev_date_iso = event.received_at[:10]
        ev_date = datetime.fromisoformat(ev_date_iso).date()
    except Exception:
        return False
    same_day: List[Dict[str, object]] = []
    for row in jobs_index:
        if (row.get("application_status") or "").lower() != "applied":
            continue
        app_iso = str(row.get("application_date") or "")[:10]
        if not app_iso:
            continue
        try:
            app_date = datetime.fromisoformat(app_iso).date()
        except Exception:
            continue
        if abs((app_date - ev_date).days) <= 1:
            same_day.append(row)
    if len(same_day) == 1:
        event.matched_job_id = str(same_day[0]["id"])
        event.match_status = "matched"
        # Always upgrade firm + role display to the canonical Firestore values
        # when the date-match resolves uniquely — the JobServe parser output
        # is just a JS-code fragment, never the real role.
        if same_day[0].get("company"):
            event.company = str(same_day[0]["company"])
        if same_day[0].get("role"):
            event.role = str(same_day[0]["role"])
        return True
    if len(same_day) > 1:
        event.candidate_doc_ids = [str(r["id"]) for r in same_day[:5]]
        event.match_status = "ambiguous"
    return False


def _reconcile(event: Event, jobs_index: List[Dict[str, object]]) -> None:
    """Set matched_job_id / match_status / candidate_doc_ids on the event in place."""
    if not jobs_index:
        return

    # 0) JobServe agency confirmations — empty body, recover via date proximity
    if _reconcile_jobserve_by_date(event, jobs_index):
        return

    # 1) Link / job-id match — deterministic
    if event.job_url:
        url_l = event.job_url.lower()
        # try last numeric path segment as req id
        req_id_match = re.search(r"(?:job/|/jobs/|/view/|/openings/|requisition[/=])(\d{4,})", url_l)
        req_id = req_id_match.group(1) if req_id_match else ""

        link_matches = []
        for row in jobs_index:
            link = (row["link"] or "").lower()
            if not link:
                continue
            if url_l in link or link in url_l:
                link_matches.append(row["id"])
            elif req_id and req_id in link:
                link_matches.append(row["id"])
        if len(link_matches) == 1:
            event.matched_job_id = link_matches[0]
            event.match_status = "matched"
            return
        if len(link_matches) > 1:
            event.matched_job_id = ""
            event.candidate_doc_ids = link_matches[:5]
            event.match_status = "ambiguous"
            return

    # 2) Fuzzy match — require company AND role token overlap
    if not event.company:
        event.match_status = "no_match"
        return
    company_norm = _norm_company(event.company)
    candidates: List[Tuple[str, float]] = []
    role_tokens = _tokens(event.role)
    for row in jobs_index:
        rc = _norm_company(row["company"])
        if not rc or not company_norm:
            continue
        # company match: either equal-after-norm or one contains the other
        if rc == company_norm or rc in company_norm or company_norm in rc:
            jac = _jaccard(role_tokens, _tokens(row["role"]))
            # If no role on event, still allow but lower the cap
            score = jac if role_tokens else 0.5
            if score >= 0.6 or (not role_tokens and score >= 0.5):
                candidates.append((row["id"], score))

    if not candidates:
        event.match_status = "no_match"
        return
    candidates.sort(key=lambda x: x[1], reverse=True)
    if len(candidates) == 1 or (candidates[0][1] - candidates[1][1] >= 0.2):
        event.matched_job_id = candidates[0][0]
        event.match_status = "matched"
    else:
        event.candidate_doc_ids = [c[0] for c in candidates[:5]]
        event.match_status = "ambiguous"


# ---------- Firestore writers ----------

_TERMINAL_STATUSES = {"applied", "interview", "offer", "rejected"}


def _write_events(client, events: List[Event], dry_run: bool) -> int:
    if dry_run or client is None:
        return 0
    written = 0
    for ev in events:
        if ev.event_type == "noise":
            continue
        doc_id = hashlib.sha256(ev.message_id.encode("utf-8")).hexdigest()[:24]
        try:
            client.collection("application_events").document(doc_id).set(
                asdict(ev) | {"updated_at": datetime.now(timezone.utc).isoformat()},
                merge=True,
            )
            written += 1
        except Exception as exc:
            print(f"event write failed for {doc_id}: {exc}", file=sys.stderr)
    return written


def _update_job_statuses(client, events: List[Event], jobs_index: List[Dict[str, object]], dry_run: bool) -> int:
    """Advance application_status on matched jobs. Never downgrade."""
    if dry_run or client is None:
        return 0
    by_id = {row["id"]: row for row in jobs_index}
    updates = 0
    for ev in events:
        if ev.match_status != "matched" or not ev.matched_job_id:
            continue
        if ev.event_type == "noise":
            continue
        row = by_id.get(ev.matched_job_id) or {}
        current = (row.get("application_status") or "").lower()
        # Don't downgrade past terminal statuses
        target = {
            "application_confirmation": "applied",
            "interview_invite": "interview",
            "rejection": "rejected",
        }.get(ev.event_type)
        if not target:
            continue
        # status hierarchy: saved < shortlisted < ready_to_apply < applied < interview < offer/rejected
        rank = {"": 0, "saved": 1, "shortlist": 2, "shortlisted": 2, "ready_to_apply": 3,
                "applied": 4, "interview": 5, "shortlist_interview": 5, "offer": 6, "rejected": 6, "dismiss": 0, "dismissed": 0}
        if rank.get(current, 0) >= rank.get(target, 0):
            continue
        update = {
            "application_status": target,
            "auto_detected": True,
            "last_event_type": ev.event_type,
            "last_event_at": ev.received_at,
            "evidence_msg_ids": [ev.message_id],
            "detection_confidence": ev.confidence,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if target == "applied":
            # match the YYYY-MM-DDT00:00:00.000Z format used by the dashboard
            try:
                day = ev.received_at[:10]
                update["application_date"] = f"{day}T00:00:00.000Z"
            except Exception:
                pass
        try:
            client.collection(config.FIREBASE_COLLECTION).document(ev.matched_job_id).set(update, merge=True)
            updates += 1
        except Exception as exc:
            print(f"job update failed for {ev.matched_job_id}: {exc}", file=sys.stderr)
    return updates


def _write_unmatched_inserts(client, events: List[Event], dry_run: bool) -> int:
    """For confirmed application events that didn't match any existing job, insert a new doc."""
    if dry_run or client is None:
        return 0
    inserts = 0
    for ev in events:
        if ev.event_type != "application_confirmation":
            continue
        if ev.match_status != "no_match":
            continue
        if not ev.company:
            continue  # skip truly unknown ones
        seed = (ev.job_url or f"{ev.company}-{ev.role}-{ev.message_id}").encode("utf-8")
        doc_id = hashlib.sha256(seed).hexdigest()[:24]
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            day = ev.received_at[:10]
            app_date = f"{day}T00:00:00.000Z"
        except Exception:
            app_date = now_iso
        payload = {
            "role": ev.role or "(role not parsed)",
            "company": ev.company,
            "location": "",
            "link": ev.job_url,
            "source": "inbox_scan",
            "application_status": "applied",
            "application_date": app_date,
            "auto_detected": True,
            "evidence_msg_ids": [ev.message_id],
            "detection_confidence": ev.confidence,
            "last_event_type": ev.event_type,
            "last_event_at": ev.received_at,
            "created_at": now_iso,
            "updated_at": now_iso,
            "last_seen_at": now_iso,
        }
        try:
            client.collection(config.FIREBASE_COLLECTION).document(doc_id).set(payload, merge=True)
            inserts += 1
        except Exception as exc:
            print(f"unmatched insert failed for {doc_id}: {exc}", file=sys.stderr)
    return inserts


# ---------- Main pipeline ----------

def _parse_received_iso(date_header: str) -> str:
    try:
        dt = email.utils.parsedate_to_datetime(date_header)
        if dt is None:
            return datetime.now(timezone.utc).isoformat()
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _redact_subject(subject: str) -> str:
    s = (subject or "")[:80]
    return s.replace("\r", " ").replace("\n", " ").strip()


def run_inbox_tracker(
    since: str,
    out_path: str,
    dry_run: bool = True,
    max_messages: int = 0,
) -> RunResult:
    started = datetime.now(timezone.utc).isoformat()
    notes: List[str] = []

    if not config.SMTP_USER or not config.SMTP_PASS:
        notes.append("FATAL: SMTP_USER / SMTP_PASS not set; cannot login to IMAP.")
        result = RunResult(
            started_at=started,
            finished_at=datetime.now(timezone.utc).isoformat(),
            since=since,
            candidates_fetched=0,
            events=[],
            notes=notes,
            firestore_writes={"events": 0, "job_updates": 0, "new_jobs": 0},
        )
        _write_artefact(out_path, result)
        return result

    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    try:
        imap.login(config.SMTP_USER, config.SMTP_PASS)
    except Exception as exc:
        notes.append(f"FATAL: IMAP login failed: {type(exc).__name__}: {exc}")
        result = RunResult(
            started_at=started,
            finished_at=datetime.now(timezone.utc).isoformat(),
            since=since,
            candidates_fetched=0,
            events=[],
            notes=notes,
            firestore_writes={"events": 0, "job_updates": 0, "new_jobs": 0},
        )
        _write_artefact(out_path, result)
        return result

    try:
        folder = _find_all_mail_folder(imap)
        notes.append(f"Selected folder {folder}")
        typ, _ = imap.select(folder, readonly=True)
        if typ != "OK":
            notes.append(f"WARN: select {folder} non-OK; falling back to INBOX")
            imap.select("INBOX", readonly=True)

        all_uids: List[bytes] = []
        seen: set = set()
        for query in _build_search_batches(since):
            uids = _x_gm_search(imap, query)
            for u in uids:
                if u not in seen:
                    seen.add(u)
                    all_uids.append(u)
            notes.append(f"search bucket returned {len(uids)} uids (cumulative dedup {len(all_uids)})")
        if max_messages and len(all_uids) > max_messages:
            notes.append(f"truncating from {len(all_uids)} to max_messages={max_messages}")
            all_uids = all_uids[-max_messages:]  # keep most recent

        headers = _fetch_headers(imap, all_uids)
        notes.append(f"fetched headers for {len(headers)} messages")

        events: List[Event] = []
        for uid, hdrs in headers.items():
            subject = hdrs.get("subject", "")
            sender = hdrs.get("from", "")
            msg_id = hdrs.get("message_id") or f"uid:{uid.decode()}"
            domain = _sender_domain(sender)

            # Cheap pre-check: must look like applications mail in some way
            looks_relevant = (
                any(d in domain for d in ATS_SENDER_DOMAINS)
                or any(p in subject.lower() for p in AMBIGUOUS_KEYWORDS)
            )
            if not looks_relevant:
                continue

            body = _fetch_body_text(imap, uid)
            rule_type, rule_conf = _classify_by_rules(subject, body, sender)
            company, role = _extract_company_role(subject, body, sender)
            job_url = _extract_job_url(body)
            ev_type = rule_type
            ev_conf = rule_conf
            detection_source = "rules"

            if _should_call_llm(rule_type, rule_conf, subject, body, company, role):
                llm = _llm_classify(subject, body, sender)
                if llm:
                    # If rules already produced a confident type, keep it but
                    # use LLM only for company/role enrichment. Otherwise let
                    # LLM drive the classification too.
                    if rule_type in {"application_confirmation", "rejection", "interview_invite"} and rule_conf >= 0.9:
                        detection_source = "rules+llm"
                    else:
                        detection_source = "llm"
                        ev_type = llm["event_type"]
                        ev_conf = max(rule_conf, float(llm["confidence"]))
                    llm_company = llm.get("company", "").strip()
                    llm_role = llm.get("role", "").strip()
                    # Reject LLM dupes (Hawk/Hawk problem) and "the company"
                    # type non-answers.
                    if llm_company and llm_role and llm_company.lower() == llm_role.lower():
                        llm_role = ""
                    if llm_company and not company:
                        company = llm_company
                    if llm_role and not role and llm_role.lower() != (company or "").lower():
                        role = llm_role
                    # Tiny courtesy delay so we don't slam the LLM
                    time.sleep(0.15)

            # Final guard: company should never equal role
            if company and role and company.lower() == role.lower():
                role = ""

            if ev_type == "noise":
                continue

            events.append(Event(
                message_id=msg_id,
                received_at=_parse_received_iso(hdrs.get("date", "")),
                event_type=ev_type,
                confidence=ev_conf,
                company=company,
                role=role,
                job_url=job_url,
                ats_family=_ats_family_from_domain(domain),
                sender=sender,
                subject_redacted=_redact_subject(subject),
                detection_source=detection_source,
                body_snippet=(body or "")[:400].replace("\r", " ").replace("\n", " "),
            ))
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    # Reconcile + write
    client = init_firestore_client()
    jobs_index = _load_jobs_index(client)
    notes.append(f"loaded {len(jobs_index)} existing job docs for reconciliation")
    for ev in events:
        _reconcile(ev, jobs_index)

    fs_events = _write_events(client, events, dry_run)
    fs_updates = _update_job_statuses(client, events, jobs_index, dry_run)
    fs_inserts = _write_unmatched_inserts(client, events, dry_run)

    finished = datetime.now(timezone.utc).isoformat()
    result = RunResult(
        started_at=started,
        finished_at=finished,
        since=since,
        candidates_fetched=len(headers),
        events=events,
        notes=notes,
        firestore_writes={
            "events": fs_events,
            "job_updates": fs_updates,
            "new_jobs": fs_inserts,
        },
    )
    _write_artefact(out_path, result)
    _print_summary(result, dry_run)
    return result


# Canonical display names for aliased firms — used in tracker output so the
# user sees "JPMorgan Chase" not "Jpmorgan" or "Chase".
CANONICAL_DISPLAY = {
    "jpmorgan chase": "JPMorgan Chase",
    "rbc": "RBC",
    "natwest group": "NatWest Group",
    "checkout.com": "Checkout.com",
    "wise": "Wise",
}


def _canonical_display(company: str) -> str:
    """Return the preferred display string for a company, applying aliases."""
    if not company:
        return ""
    norm = _norm_company(company)
    return CANONICAL_DISPLAY.get(norm, company)


def _canonical_role(role: str) -> str:
    """Return a normalised role key for grouping.

    Collapses Round-N suffixes, requisition IDs, and parenthetical sub-team
    qualifiers so the same underlying role doesn't split into multiple rows
    just because the email subject varied.
    """
    r = (role or "").lower().strip()
    if not r:
        return ""
    # Drop trailing "Round N" (and preceding em/en/hyphen / req-id)
    r = re.sub(r"\s*[-–—]?\s*\d{4,}\s+round\s+\d+\s*$", "", r)
    r = re.sub(r"\s*round\s+\d+\s*$", "", r)
    # Drop trailing requisition IDs ("- 210719366" / "– 210719366")
    r = re.sub(r"\s*[-–—]\s*\d{4,}\s*$", "", r)
    # Drop parenthetical sub-team qualifiers — e.g. "Product Manager (Central Operations)"
    r = re.sub(r"\s*\([^)]*\)\s*$", "", r)
    r = re.sub(r"\s+", " ", r).strip()
    return r


def _merge_into(target: Dict[str, object], src: Dict[str, object]) -> None:
    """Merge src group into target group, taking earliest dates."""
    target["event_count"] = int(target["event_count"]) + int(src["event_count"])
    target["evidence_msg_ids"].extend(src.get("evidence_msg_ids", []))  # type: ignore
    for k in ("applied_date", "responded_date", "interview_offered_date", "rejected_date"):
        nv = str(src.get(k) or "")
        cv = str(target.get(k) or "")
        if nv and (not cv or nv < cv):
            target[k] = nv
    if not target.get("matched_job_id") and src.get("matched_job_id"):
        target["matched_job_id"] = src["matched_job_id"]


def _build_tracker(events: List[Event]) -> List[Dict[str, object]]:
    """Roll up events into one row per (firm, role) for the user-facing tracker.

    Two passes:
      1. Group by (firm_norm, role_lower).
      2. For each firm with a single role-having group + N no-role groups,
         merge the no-role groups into the role-having group (same campaign).
         When multiple role-having groups exist, keep no-role groups separate
         so the user can disambiguate manually.
    """
    groups: Dict[Tuple[str, str], Dict[str, object]] = {}
    for ev in events:
        if ev.event_type == "noise":
            continue
        firm_key = _norm_company(ev.company) or "(unknown)"
        role_key = _canonical_role(ev.role)
        key = (firm_key, role_key)
        g = groups.setdefault(key, {
            "firm": _canonical_display(ev.company) or "(unknown)",
            "role": ev.role or "(role not parsed)",
            "applied_date": "",
            "responded_date": "",
            "interview_offered_date": "",
            "rejected_date": "",
            "current_status": "",
            "event_count": 0,
            "matched_job_id": "",
            "evidence_msg_ids": [],
        })
        g["event_count"] = int(g["event_count"]) + 1
        g["evidence_msg_ids"].append(ev.message_id)  # type: ignore
        # Prefer richer/canonical display for firm
        new_display = _canonical_display(ev.company)
        if new_display and (g["firm"] == "(unknown)" or len(new_display) >= len(str(g["firm"]))):
            g["firm"] = new_display
        if ev.role and (g["role"] == "(role not parsed)" or len(ev.role) > len(str(g["role"]))):
            g["role"] = ev.role
        date = ev.received_at[:10]
        if ev.event_type == "application_confirmation" and (not g["applied_date"] or date < str(g["applied_date"])):
            g["applied_date"] = date
        if ev.event_type == "interview_invite" and (not g["interview_offered_date"] or date < str(g["interview_offered_date"])):
            g["interview_offered_date"] = date
        if ev.event_type == "rejection" and (not g["rejected_date"] or date < str(g["rejected_date"])):
            g["rejected_date"] = date
        if ev.event_type != "application_confirmation":
            if not g["responded_date"] or date < str(g["responded_date"]):
                g["responded_date"] = date
        if ev.matched_job_id and not g["matched_job_id"]:
            g["matched_job_id"] = ev.matched_job_id

    # Pass 2: merge no-role groups into role-having group for the same firm
    # when there is exactly one role-having group OR exactly one no-role group
    # collapses cleanly into the dominant role-having group.
    by_firm: Dict[str, List[Tuple[str, Dict[str, object]]]] = {}
    for (firm_norm, role_lower), g in groups.items():
        by_firm.setdefault(firm_norm, []).append((role_lower, g))

    merged: List[Dict[str, object]] = []
    for firm_norm, items in by_firm.items():
        role_having = [(rl, g) for rl, g in items if rl]
        no_role = [(rl, g) for rl, g in items if not rl]
        if not no_role:
            merged.extend(g for _, g in role_having)
            continue
        if not role_having:
            # All no-role for this firm — emit as-is
            merged.extend(g for _, g in no_role)
            continue
        if len(role_having) == 1:
            # Single role campaign — all no-role events fold in
            target = role_having[0][1]
            for _, nr in no_role:
                _merge_into(target, nr)
            merged.append(target)
        else:
            # Multiple distinct roles for same firm. Fold no-role events
            # into the role-having group whose date range is closest in time.
            for _, nr in no_role:
                nr_dates = [d for d in (nr["applied_date"], nr["responded_date"],
                                          nr["interview_offered_date"], nr["rejected_date"]) if d]
                if not nr_dates:
                    merged.append(nr)
                    continue
                nr_pivot = min(nr_dates)
                best = None
                best_dist = 10 ** 9
                for _, rh in role_having:
                    rh_dates = [d for d in (rh["applied_date"], rh["responded_date"],
                                              rh["interview_offered_date"], rh["rejected_date"]) if d]
                    if not rh_dates:
                        continue
                    from datetime import date as _date
                    try:
                        rh_min = min(_date.fromisoformat(d) for d in rh_dates)
                        rh_max = max(_date.fromisoformat(d) for d in rh_dates)
                        nr_d = _date.fromisoformat(nr_pivot)
                        if rh_min <= nr_d <= rh_max:
                            dist = 0
                        else:
                            dist = min(abs((nr_d - rh_min).days), abs((nr_d - rh_max).days))
                    except Exception:
                        dist = 10 ** 9
                    if dist < best_dist:
                        best_dist = dist
                        best = rh
                if best is not None and best_dist <= 60:
                    _merge_into(best, nr)
                else:
                    merged.append(nr)
            merged.extend(g for _, g in role_having)

    # Derive current_status — terminal states win
    for g in merged:
        if g["rejected_date"]:
            g["current_status"] = "rejected"
        elif g["interview_offered_date"]:
            g["current_status"] = "interview"
        elif g["applied_date"]:
            g["current_status"] = "applied"
        else:
            g["current_status"] = "unknown"

    def _latest(g: Dict[str, object]) -> str:
        return max(
            str(g.get("applied_date") or ""),
            str(g.get("interview_offered_date") or ""),
            str(g.get("rejected_date") or ""),
            str(g.get("responded_date") or ""),
        )
    merged.sort(key=_latest, reverse=True)
    return merged


def _write_artefact(path: str, result: RunResult) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tracker = _build_tracker(result.events)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({
            "started_at": result.started_at,
            "finished_at": result.finished_at,
            "since": result.since,
            "candidates_fetched": result.candidates_fetched,
            "firestore_writes": result.firestore_writes,
            "notes": result.notes,
            "tracker": tracker,
            "events": [asdict(ev) for ev in result.events],
        }, fh, indent=2)


def _print_summary(result: RunResult, dry_run: bool) -> None:
    """Append a redacted markdown summary to GITHUB_STEP_SUMMARY (or stdout)."""
    by_type: Dict[str, int] = {}
    by_match: Dict[str, int] = {}
    for ev in result.events:
        by_type[ev.event_type] = by_type.get(ev.event_type, 0) + 1
        by_match[ev.match_status] = by_match.get(ev.match_status, 0) + 1

    lines = [
        "# Application Tracker — Inbox Scan",
        "",
        f"- Window: since `{result.since}`",
        f"- Mode: **{'DRY RUN' if dry_run else 'COMMIT'}**",
        f"- Candidates fetched: {result.candidates_fetched}",
        f"- Events extracted: {len(result.events)}",
        f"- Firestore writes: events={result.firestore_writes['events']}, job_updates={result.firestore_writes['job_updates']}, new_jobs={result.firestore_writes['new_jobs']}",
        "",
        "## Events by type",
    ]
    for k, v in sorted(by_type.items(), key=lambda kv: -kv[1]):
        lines.append(f"- {k}: {v}")
    lines += ["", "## Events by reconciliation match"]
    for k, v in sorted(by_match.items(), key=lambda kv: -kv[1]):
        lines.append(f"- {k}: {v}")

    # Grouped tracker view — the chart-ready schema
    tracker = _build_tracker(result.events)
    lines += ["", f"## Tracker ({len(tracker)} firm × role rows)", "",
              "| Firm | Role | Applied | Responded | Interview | Rejected | Status | Events |",
              "|---|---|---|---|---|---|---|---|"]
    for row in tracker:
        lines.append(
            f"| {str(row['firm'])[:32]} | {str(row['role'])[:48]} | "
            f"{row.get('applied_date') or '—'} | {row.get('responded_date') or '—'} | "
            f"{row.get('interview_offered_date') or '—'} | "
            f"{row.get('rejected_date') or '—'} | {row['current_status']} | "
            f"{row['event_count']} |"
        )

    lines += ["", "## Recent events (most recent first)", "",
              "| Received | Type | Confidence | Company | Role | Match | Source |",
              "|---|---|---|---|---|---|---|"]
    sorted_events = sorted(result.events, key=lambda e: e.received_at, reverse=True)
    for ev in sorted_events[:80]:
        lines.append(
            f"| {ev.received_at[:10]} | {ev.event_type} | {ev.confidence:.2f} | "
            f"{(ev.company or '—')[:32]} | {(ev.role or '—')[:48]} | "
            f"{ev.match_status} | {ev.detection_source} |"
        )

    body = "\n".join(lines) + "\n"
    print(body)
    step_summary = os.getenv("GITHUB_STEP_SUMMARY")
    if step_summary:
        try:
            with open(step_summary, "a", encoding="utf-8") as fh:
                fh.write(body)
        except Exception:
            pass
