from __future__ import annotations

from datetime import datetime
from email.utils import make_msgid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from typing import List

from . import boards
from . import config
from .models import JobRecord
from .utils import select_top_pick


def build_sources_summary(*, compact: bool = False) -> str:
    if compact:
        return "LinkedIn, eFinancialCareers, Workday, ATS feeds, and selected job boards"

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


def build_email_html(records: List[JobRecord], window_hours: int) -> str:
    header = f"Daily Job Digest · Last {window_hours} hours"
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
            f"· <strong>Source:</strong> {top_pick.source} · <strong>Fit:</strong> {top_pick.fit_score}%</div>"
            f"<div style='margin-top:8px; color:#333;'><strong>Why you fit:</strong> "
            f"{escape(compact_text(top_pick.why_fit, 190))}</div>"
            f"<div style='margin-top:8px; color:#333;'><strong>Action:</strong> "
            f"{escape(action_line(top_pick))}</div>"
            "</div>"
        )

    rows = []
    main_records = [rec for rec in records if rec.email_bucket != "borderline"]
    borderline_records = [rec for rec in records if rec.email_bucket == "borderline"]
    ordered_records = main_records + borderline_records
    for idx, rec in enumerate(ordered_records):
        if rec.fit_score >= 85:
            fit_color = "#1B7F5D"
        elif rec.fit_score >= 75:
            fit_color = "#2B6CB0"
        else:
            fit_color = "#8A5A0B"

        row_bg = "#FFF7ED" if rec.email_bucket == "borderline" else ("#FFFFFF" if idx % 2 == 0 else "#F9FBFD")
        if top_pick and rec.link == top_pick.link:
            row_bg = "#FFF3D6"
        badge = ""
        if top_pick and rec.link == top_pick.link:
            badge = (
                "<span style='display:inline-block; margin-left:8px; padding:2px 6px; "
                "border-radius:10px; background:#F5A623; color:#fff; font-size:11px; "
                "font-weight:bold;'>Top Pick</span>"
            )
        elif rec.email_bucket == "borderline":
            badge = (
                "<span style='display:inline-block; margin-left:8px; padding:2px 6px; "
                "border-radius:10px; background:#D97706; color:#fff; font-size:11px; "
                "font-weight:bold;'>Maybe</span>"
            )

        rows.append(
            f"<tr style='background:{row_bg};'>"
            f"<td style='padding:10px;'><a href='{rec.link}' style='color:#0B4F8A; text-decoration:none;'><strong>{rec.role}</strong></a>{badge}"
            f"<div style='color:#666; font-size:12px; margin-top:4px;'>{rec.company} · {rec.location}</div>"
            f"<div style='color:#777; font-size:12px; margin-top:4px;'>Released {display_posted(rec.posted)}</div></td>"
            f"<td style='padding:10px; color:#333; white-space:nowrap;'>{escape(rec.source)}</td>"
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

    import smtplib

    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
            server.starttls()
            server.login(config.SMTP_USER, config.SMTP_PASS)
            server.send_message(msg)
        ensure_self_sent_digest_reaches_inbox(msg["Message-ID"], msg.as_bytes())
        print("Email sent successfully")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"Email send failed: {exc}")
        return False


def ensure_self_sent_digest_reaches_inbox(message_id: str, raw_bytes: bytes) -> None:
    """Gmail places self-sent SMTP messages in Sent/All Mail, not Inbox.

    Append the raw message directly to INBOX via IMAP after SMTP send. APPEND is
    synchronous and avoids the race window where a search-then-label approach
    runs before Gmail has indexed the just-sent message.
    """
    if not message_id or not raw_bytes:
        print("Inbox APPEND skipped: missing message_id or raw_bytes")
        return
    if config.SMTP_USER.lower() != config.TO_EMAIL.lower():
        print("Inbox APPEND skipped: SMTP_USER and TO_EMAIL differ (not self-send)")
        return
    if "gmail.com" not in config.SMTP_HOST.lower():
        print("Inbox APPEND skipped: SMTP host is not Gmail")
        return

    try:
        import imaplib

        with imaplib.IMAP4_SSL("imap.gmail.com") as imap:
            imap.login(config.SMTP_USER, config.SMTP_PASS)
            status, response = imap.append("INBOX", None, None, raw_bytes)
            if status == "OK":
                print(f"Email appended to Inbox via IMAP: {response}")
            else:
                print(f"Inbox APPEND non-OK status: {status} {response}")
            imap.logout()
    except Exception as exc:  # noqa: BLE001
        print(f"Inbox APPEND failed: {type(exc).__name__}: {exc}")
