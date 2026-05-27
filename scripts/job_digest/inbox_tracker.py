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
            if text:
                return text[:20000]
            if html:
                # very simple HTML strip — keeps URLs intact
                stripped = re.sub(r"<[^>]+>", " ", html)
                stripped = re.sub(r"\s+", " ", stripped)
                return stripped[:20000]
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


def _classify_by_rules(subject: str, body: str) -> Tuple[str, float]:
    """Rules-only classification. Returns (event_type, confidence)."""
    s = (subject or "").lower()
    b = (body or "").lower()[:4000]

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
    ]
    if hit(rejection_signals, b) or hit(["unfortunately", "regret to inform", "not moving forward"], s):
        return "rejection", 0.85

    # Interview / next-step signals
    interview_strong = [
        "schedule a time", "schedule a call", "calendly", "would you be available",
        "invite you to interview", "phone screen", "screening call", "next stage",
        "we'd love to chat", "would love to chat", "video call",
    ]
    if hit(["interview"], s) or hit(interview_strong, b):
        return "interview_invite", 0.9

    # Application confirmation signals
    application_subject_strong = [
        "thank you for applying", "thanks for applying", "thank you for your application",
        "thanks for your application", "application received", "application submitted",
        "we received your application", "we have received your application",
        "your application has been received", "your application was sent",
        "application confirmation",
    ]
    application_body_strong = [
        "thank you for applying", "thank you for your application",
        "we have received your application", "we received your application",
        "your application has been received", "successfully submitted",
        "your application was sent",
    ]
    if hit(application_subject_strong, s) or hit(application_body_strong, b):
        return "application_confirmation", 0.92

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


def _extract_company_role(subject: str, body: str, sender: str) -> Tuple[str, str]:
    """Cheap company/role extraction from subject and body. Best-effort only."""
    s = subject or ""
    company = ""
    role = ""

    # Subject patterns: "Your application to Acme for Senior PM"
    m = re.search(r"(?:application (?:to|for|with)|applying (?:to|with)) ([A-Z][\w &'.\-]{1,60})", s, re.IGNORECASE)
    if m:
        company = m.group(1).strip()

    # "Your application for <Role> at <Company>"
    m2 = re.search(r"application (?:for|to)\s+(.+?)\s+at\s+(.+?)(?:\s+(?:has|was|is)|[:\-—|]|$)", s, re.IGNORECASE)
    if m2:
        role = role or m2.group(1).strip()
        company = company or m2.group(2).strip()

    # "<Role> at <Company>"
    m3 = re.search(r"^(.+?)\s+at\s+(.+?)$", s)
    if m3 and not role:
        role = m3.group(1).strip()
        company = company or m3.group(2).strip()

    # LinkedIn distinct pattern: "Your application was sent to <Company>"
    m4 = re.search(r"your application was sent to\s+(.+?)(?:[:\-—|]|$)", s, re.IGNORECASE)
    if m4:
        company = m4.group(1).strip()

    # Body fallback: "Position: <Role>" / "Role: <Role>"
    if not role and body:
        m5 = re.search(r"\b(?:Position|Role|Job title)\s*[:\-]\s*([^\n\r]{2,120})", body, re.IGNORECASE)
        if m5:
            role = m5.group(1).strip()
    if not company and body:
        m6 = re.search(r"\b(?:Company|Employer|Organization)\s*[:\-]\s*([^\n\r]{2,80})", body, re.IGNORECASE)
        if m6:
            company = m6.group(1).strip()

    # Sender-domain hint for company when nothing else worked
    if not company:
        domain = _sender_domain(sender)
        if domain and not any(ats in domain for ats in ATS_SENDER_DOMAINS):
            base = domain.split(".")[0]
            if base not in {"mail", "no-reply", "noreply", "donotreply"}:
                company = base.title()

    # Trim noisy trailing punctuation
    role = re.sub(r"\s+", " ", role).strip(" -—|:;.")[:120]
    company = re.sub(r"\s+", " ", company).strip(" -—|:;.")[:80]
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


def _should_call_llm(rule_type: str, rule_conf: float, subject: str, body: str) -> bool:
    """Decide if LLM fallback should run. Aim for high recall, low spam."""
    if rule_type != "noise" and rule_conf >= 0.9:
        return False  # rules already confident
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
    s = re.sub(r"\b(ltd|limited|inc|llc|plc|gmbh|ag|bv|nv|sa|sas|group|holdings|holding)\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def _load_jobs_index(client) -> List[Dict[str, object]]:
    """Pull a minimal index of {id, company, role, link, application_status} from Firestore."""
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
            })
    except Exception as exc:
        print(f"Job index load failed: {exc}", file=sys.stderr)
    return rows


def _reconcile(event: Event, jobs_index: List[Dict[str, object]]) -> None:
    """Set matched_job_id / match_status / candidate_doc_ids on the event in place."""
    if not jobs_index:
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
            rule_type, rule_conf = _classify_by_rules(subject, body)
            company, role = _extract_company_role(subject, body, sender)
            job_url = _extract_job_url(body)
            ev_type = rule_type
            ev_conf = rule_conf
            detection_source = "rules"

            if _should_call_llm(rule_type, rule_conf, subject, body):
                llm = _llm_classify(subject, body, sender)
                if llm:
                    detection_source = "llm"
                    ev_type = llm["event_type"]
                    ev_conf = max(rule_conf, float(llm["confidence"]))
                    if llm.get("company") and not company:
                        company = llm["company"]
                    if llm.get("role") and not role:
                        role = llm["role"]
                    # Tiny courtesy delay so we don't slam the LLM
                    time.sleep(0.15)

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


def _write_artefact(path: str, result: RunResult) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({
            "started_at": result.started_at,
            "finished_at": result.finished_at,
            "since": result.since,
            "candidates_fetched": result.candidates_fetched,
            "firestore_writes": result.firestore_writes,
            "notes": result.notes,
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
