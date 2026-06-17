from __future__ import annotations

from datetime import datetime
from email.utils import make_msgid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from typing import List

from . import boards
from . import config
from .firestore import record_document_id
from .models import JobRecord
from .utils import parse_applicant_count, select_top_pick


def build_sources_summary(*, compact: bool = False) -> str:
    if compact:
        return "LinkedIn, eFinancialCareers, Workday, ATS feeds, recruiter pages, and selected job boards"

    if config.SOURCES_SUMMARY_OVERRIDE:
        return config.SOURCES_SUMMARY_OVERRIDE

    board_names = [source["name"] for source in boards.JOB_BOARD_SOURCES]
    boards_summary = f"Job boards ({len(board_names)}): " + ", ".join(board_names)
    company_batch = config.select_company_batch(config.SEARCH_COMPANIES)
    company_summary = (
        f"Company targets ({len(config.SEARCH_COMPANIES)} total / {len(company_batch)} per run)"
    )

    ats_summary = (
        "ATS boards: "
        f"Greenhouse ({len(boards.GREENHOUSE_BOARDS)}), "
        f"Lever ({len(boards.LEVER_BOARDS)}), "
        f"SmartRecruiters ({len(boards.SMARTRECRUITERS_COMPANIES)}), "
        f"Ashby ({len(boards.ASHBY_BOARDS)})"
    )

    summary = " · ".join(
        [
            "LinkedIn (guest search + company search)",
            company_summary,
            "Recruiter pages (free contract/change search)",
            boards_summary,
            ats_summary,
        ]
    )

    missing_keys = []
    if not (config.ADZUNA_APP_ID and config.ADZUNA_APP_KEY):
        missing_keys.append("Adzuna")
    if not config.JOOBLE_API_KEY:
        missing_keys.append("Jooble")
    if not config.REED_API_KEY:
        missing_keys.append("Reed")
    if not config.CV_LIBRARY_API_KEY:
        missing_keys.append("CVLibrary")
    if missing_keys:
        summary = f"{summary} · APIs pending: {', '.join(missing_keys)}"

    if boards.WORKDAY_SITES:
        summary = f"{summary} · Workday feeds ({len(boards.WORKDAY_SITES)})"
    else:
        summary = f"{summary} · Workday feeds (0 configured)"
    return summary


def _apply_link(rec: JobRecord) -> str:
    """One-click deep link into the portal, falling back to the raw job link."""
    if config.SITE_URL:
        return f"{config.SITE_URL}/index.html#apply-now={record_document_id(rec)}"
    return rec.link or ""


def build_email_html(records: List[JobRecord], window_hours: int, hot_lane: List[JobRecord] | None = None) -> str:
    header = f"Daily Job Digest · Last {window_hours} hours"
    hot_lane = hot_lane or []
    if not records:
        return (
            "<div style='font-family:Arial, sans-serif; max-width:900px; margin:0 auto;'>"
            f"<h2 style='color:#0B4F8A;'>{header}</h2>"
            f"<p style='color:#333;'>Preferences: {config.PREFERENCES}</p>"
            f"<p style='color:#333;'>Sources checked: {build_sources_summary(compact=True)}</p>"
            "<div style='background:#F7F9FC; padding:16px; border-radius:8px;'>"
            "<p style='margin:0;'>No roles matched in this window. I will keep scanning and send the next update tomorrow.</p>"
            "</div>"
            "</div>"
        )

    main_records_for_top_pick = [rec for rec in records if rec.email_bucket != "borderline"]
    top_pick = select_top_pick(main_records_for_top_pick)

    def compact_text(value: str, limit: int = 150) -> str:
        text = " ".join((value or "").split())
        if len(text) <= limit:
            return text
        return text[: limit - 1].rstrip() + "…"

    def display_posted(value: str) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed.strftime("%d %b")
        except ValueError:
            return compact_text(text, 24)

    def action_line(rec: JobRecord) -> str:
        return compact_text(rec.apply_tips or rec.cv_gap or rec.tailored_summary, 150)

    top_pick_section = ""
    if top_pick:
        top_pick_section = (
            "<div style='border:1px solid #F3C969; border-left:6px solid #F5A623; "
            "background:#FFF8E6; padding:12px; border-radius:8px; margin-bottom:14px;'>"
            "<div style='font-weight:bold; color:#8A5A0B; margin-bottom:6px;'>Top Pick</div>"
            f"<div style='font-size:16px; font-weight:bold; color:#0B4F8A;'>"
            f"<a href='{top_pick.link}' style='color:#0B4F8A; text-decoration:none;'>"
            f"{top_pick.role}</a></div>"
            f"<div style='color:#555; margin-top:4px;'>{top_pick.company} · {top_pick.location}</div>"
            f"<div style='margin-top:8px; color:#333;'><strong>Released:</strong> {display_posted(top_pick.posted)} "
            f"· <strong>Source:</strong> {top_pick.source} · <strong>Type:</strong> {escape(top_pick.employment_type or 'Unknown')} "
            f"· <strong>Status:</strong> {escape(top_pick.verification_status or 'Unverified')} "
            f"· <strong>Fit:</strong> {top_pick.fit_score}%</div>"
            f"<div style='margin-top:8px; color:#333;'><strong>Why you fit:</strong> "
            f"{escape(compact_text(top_pick.why_fit, 190))}</div>"
            f"<div style='margin-top:8px; color:#333;'><strong>Action:</strong> "
            f"{escape(action_line(top_pick))}</div>"
            "</div>"
        )

    hot_lane_section = ""
    if hot_lane:
        digest_time = datetime.now().strftime("%H:%M")
        cards = []
        for rec in hot_lane:
            n = parse_applicant_count(rec.applicant_count)
            applicants = f"{n} applicants" if n is not None else "few applicants"
            link = _apply_link(rec)
            cards.append(
                "<div style='background:#fff; border:1px solid #FFD5C2; border-radius:8px; padding:10px 12px; margin-bottom:8px;'>"
                f"<div style='font-size:15px; font-weight:bold; color:#9A3412;'>{escape(rec.role)}</div>"
                f"<div style='color:#555; font-size:13px; margin-top:2px;'>{escape(rec.company)} · {escape(rec.location)}</div>"
            f"<div style='color:#777; font-size:12px; margin-top:4px;'>Fit {rec.fit_score}% · {escape(applicants)} · posted {display_posted(rec.posted)}</div>"
                f"<div style='color:#777; font-size:12px; margin-top:4px;'>{escape(rec.employment_type or 'Unknown')} · {escape(rec.verification_status or 'Unverified')}</div>"
                f"<a href='{link}' style='display:inline-block; margin-top:8px; background:#EA580C; color:#fff; "
                "text-decoration:none; font-weight:bold; padding:8px 16px; border-radius:6px;'>⚡ Apply now</a>"
                "</div>"
            )
        hot_lane_section = (
            "<div style='border:1px solid #FB923C; border-left:6px solid #EA580C; background:#FFF7ED; "
            "padding:12px; border-radius:8px; margin-bottom:14px;'>"
            "<div style='font-weight:bold; color:#9A3412; margin-bottom:8px; font-size:15px;'>"
            "🔥 Apply now — fresh &amp; low-competition</div>"
            + "".join(cards)
            + f"<div style='color:#9A3412; font-size:11px; margin-top:4px;'>"
            f"Verified fresh as of {digest_time}. These fill fast — apply early.</div>"
            "</div>"
        )

    rows = []
    top_pick_link = top_pick.link if top_pick else None
    main_records = [
        rec for rec in records
        if rec.email_bucket != "borderline" and rec.link != top_pick_link
    ]
    borderline_records = [
        rec for rec in records
        if rec.email_bucket == "borderline" and rec.link != top_pick_link
    ]

    section_order = [
        "Fresh Apply First",
        "Fresh Worth Reviewing",
        "Contract / FTC / Inside IR35",
        "Strategic Older/Reposted",
        "Fallback Adjacent",
        "Maybe / Lower Confidence",
    ]

    def section_for(rec: JobRecord) -> str:
        if rec.email_bucket == "borderline":
            return "Maybe / Lower Confidence"
        if rec.digest_section:
            return rec.digest_section
        if rec.employment_type == "Contract":
            return "Contract / FTC / Inside IR35"
        if rec.freshness_bucket == "Fresh 24h":
            return "Fresh Apply First"
        if rec.freshness_bucket == "Fresh 72h":
            return "Fresh Worth Reviewing"
        if rec.freshness_bucket in {"Last 7d", "Older/Reposted"}:
            return "Strategic Older/Reposted"
        return "Fallback Adjacent"

    grouped: dict[str, list[JobRecord]] = {section: [] for section in section_order}
    for rec in main_records + borderline_records:
        grouped.setdefault(section_for(rec), []).append(rec)

    row_index = 0
    for section in section_order:
        section_records = grouped.get(section, [])
        if not section_records:
            continue
        rows.append(
            "<tr>"
            f"<td colspan='7' style='padding:9px 10px; background:#EAF2FF; color:#0B4F8A; "
            f"font-weight:bold; border-top:1px solid #D8E2F0;'>{escape(section)}</td>"
            "</tr>"
        )
        for rec in section_records:
            idx = row_index
            row_index += 1
            if rec.fit_score >= 85:
                fit_color = "#1B7F5D"
            elif rec.fit_score >= 75:
                fit_color = "#2B6CB0"
            else:
                fit_color = "#8A5A0B"

            row_bg = "#FFF7ED" if rec.email_bucket == "borderline" else ("#FFFFFF" if idx % 2 == 0 else "#F9FBFD")
            badge = ""
            if rec.email_bucket == "borderline":
                badge = (
                    "<span style='display:inline-block; margin-left:8px; padding:2px 6px; "
                    "border-radius:10px; background:#D97706; color:#fff; font-size:11px; "
                    "font-weight:bold;'>Maybe</span>"
                )

            rows.append(
                f"<tr style='background:{row_bg};'>"
                f"<td style='padding:10px;'><a href='{rec.link}' style='color:#0B4F8A; text-decoration:none;'><strong>{rec.role}</strong></a>{badge}"
                f"<div style='color:#666; font-size:12px; margin-top:4px;'>{rec.company} · {rec.location}</div>"
                f"<div style='color:#777; font-size:12px; margin-top:4px;'>Released {display_posted(rec.posted)} · {escape(rec.freshness_bucket or 'Freshness unknown')}</div>"
                f"<div style='color:#777; font-size:12px; margin-top:4px;'>{escape((rec.role_bucket or '').replace('_', ' ') or 'role bucket pending')}</div></td>"
                f"<td style='padding:10px; color:#333; white-space:nowrap;'>{escape(rec.source)}</td>"
                f"<td style='padding:10px; color:#333; white-space:nowrap;'>{escape(rec.employment_type or 'Unknown')}</td>"
                f"<td style='padding:10px; color:#333; white-space:nowrap;'>{escape(rec.verification_status or 'Unverified')}</td>"
                f"<td style='padding:10px;'><span style='display:inline-block; padding:4px 8px; border-radius:12px; "
                f"background:{fit_color}; color:#fff; font-weight:bold;'>{rec.fit_score}%</span></td>"
                f"<td style='padding:10px; color:#333;'>{escape(compact_text(rec.why_fit, 160))}</td>"
                f"<td style='padding:10px; color:#333;'>{escape(action_line(rec))}</td>"
                "</tr>"
            )

    table = (
        "<table style='width:100%; border-collapse:collapse; font-family:Arial, sans-serif; "
        "border:1px solid #E5E9F0;'>"
        "<thead style='background:#F0F4F8;'>"
        "<tr>"
        "<th style='text-align:left; padding:10px;'>Role</th>"
        "<th style='text-align:left; padding:10px;'>Source</th>"
        "<th style='text-align:left; padding:10px;'>Type</th>"
        "<th style='text-align:left; padding:10px;'>Status</th>"
        "<th style='text-align:left; padding:10px;'>Fit</th>"
        "<th style='text-align:left; padding:10px;'>Why</th>"
        "<th style='text-align:left; padding:10px;'>Action / Watch</th>"
        "</tr>"
        "</thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )

    return (
        "<div style='font-family:Arial, sans-serif; max-width:1000px; margin:0 auto;'>"
        f"<h2 style='color:#0B4F8A; margin-bottom:4px;'>{header}</h2>"
        f"<p style='color:#555; margin-top:0;'>Preferences: {config.PREFERENCES}</p>"
        f"<p style='color:#555; margin-top:0;'>Sources checked: {build_sources_summary(compact=True)}</p>"
        f"<p style='color:#333; font-weight:bold;'>Matches found: {len(records)}</p>"
        + hot_lane_section
        + top_pick_section
        + table
        + "</div>"
    )


def send_email(subject: str, html_body: str, text_body: str) -> bool:
    if not config.EMAIL_ENABLED:
        print("Email disabled: JOB_DIGEST_EMAIL_ENABLED=false")
        return False
    if not all([config.SMTP_HOST, config.SMTP_PORT, config.SMTP_USER, config.SMTP_PASS, config.FROM_EMAIL, config.TO_EMAIL]):
        print("Email not configured: missing SMTP settings")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = config.FROM_EMAIL
    msg["To"] = config.TO_EMAIL
    msg["Message-ID"] = make_msgid(domain="job-digest.local")

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    is_self_send_gmail = (
        config.SMTP_USER.lower() == config.TO_EMAIL.lower()
        and "gmail.com" in config.SMTP_HOST.lower()
    )

    if is_self_send_gmail:
        if append_to_gmail_inbox(msg.as_bytes()):
            return True
        print("APPEND failed; falling back to SMTP delivery so the email is not lost")

    import smtplib

    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
            server.starttls()
            server.login(config.SMTP_USER, config.SMTP_PASS)
            server.send_message(msg)
        print("Email sent successfully via SMTP")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"Email send failed: {exc}")
        return False


def append_to_gmail_inbox(raw_bytes: bytes) -> bool:
    """Deliver a self-sent digest directly to Gmail INBOX via IMAP APPEND.

    For self-sends (FROM == TO on Gmail), SMTP delivery produces a Sent copy
    that Gmail sometimes also mirrors into INBOX, resulting in two separate
    messages per send. Using IMAP APPEND only puts a single copy in INBOX and
    leaves Sent empty for these self-sends, which is the desired behaviour.
    """
    if not raw_bytes:
        print("Inbox APPEND skipped: empty raw_bytes")
        return False

    try:
        import imaplib
        import re

        with imaplib.IMAP4_SSL("imap.gmail.com") as imap:
            imap.login(config.SMTP_USER, config.SMTP_PASS)
            status, response = imap.append("INBOX", None, None, raw_bytes)
            if status != "OK":
                print(f"Inbox APPEND non-OK status: {status} {response}")
                imap.logout()
                return False

            appended_uid = None
            for chunk in response or []:
                if not chunk:
                    continue
                match = re.search(rb"APPENDUID \d+ (\d+)", chunk)
                if match:
                    appended_uid = match.group(1)
                    break

            if appended_uid:
                imap.select("INBOX")
                imap.uid("STORE", appended_uid, "-FLAGS", "(\\Seen)")

                # Gmail filters do not run on APPEND'd messages, so any
                # "Skip Inbox + apply label" filter you've set up in the
                # Gmail UI is silently ignored for digest mail. Apply the
                # label and the skip-inbox toggle directly via the
                # X-GM-LABELS IMAP extension.
                import os as _os
                label = (_os.getenv("JOB_DIGEST_INBOX_LABEL") or "").strip()
                skip_inbox = (_os.getenv("JOB_DIGEST_SKIP_INBOX") or "").strip().lower() in {"1", "true", "yes"}

                if label:
                    quoted_label = f'"{label}"'
                    typ, _ = imap.uid("STORE", appended_uid, "+X-GM-LABELS", quoted_label)
                    print(f"Applied label {label!r}: {typ}")
                if skip_inbox:
                    # STORE -X-GM-LABELS "\Inbox" from INBOX context returns
                    # OK but silently no-ops in Gmail. Use the canonical
                    # idiom instead: mark \Deleted + EXPUNGE removes the
                    # message from the current label folder (INBOX) only;
                    # the message stays in All Mail with whatever other
                    # labels are applied (e.g. "Job Digest" from above).
                    typ, _ = imap.uid("STORE", appended_uid, "+FLAGS", "(\\Deleted)")
                    typ_e, expunged = imap.expunge()
                    print(f"Removed from Inbox via \\Deleted+EXPUNGE: store={typ} expunge={typ_e}")

                print(
                    f"Email delivered to Inbox via IMAP APPEND (unread): "
                    f"UID {appended_uid.decode()} response={response}"
                )
            else:
                print(f"Email delivered to Inbox via IMAP APPEND (UID not parsed): {response}")
            imap.logout()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"Inbox APPEND failed: {type(exc).__name__}: {exc}")
        return False
