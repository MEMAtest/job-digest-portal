"""Telegram push alerts for fresh, high-fit roles (Part F).

Used by the hot-scan (`runner.run_hot_scan`) to buzz the user's phone the moment
a fresh supported-ATS role appears, with a one-tap link into the portal's
one-click apply. All functions fail soft — a notification problem must never
crash the scan.

Setup (one-time): create a bot via @BotFather, send it any message, then read
your chat id from https://api.telegram.org/bot<TOKEN>/getUpdates. Set the
TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars / GitHub secrets.
"""

from __future__ import annotations

import html
from typing import Optional

import requests

from . import config
from .firestore import record_document_id
from .models import JobRecord
from .utils import parse_applicant_count

_API = "https://api.telegram.org/bot{token}/{method}"


def is_configured() -> bool:
    return bool(config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID)


def _post(method: str, payload: dict) -> bool:
    if not config.TELEGRAM_BOT_TOKEN:
        return False
    url = _API.format(token=config.TELEGRAM_BOT_TOKEN, method=method)
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code != 200:
            print(f"Telegram {method} failed: {resp.status_code} {resp.text[:200]}")
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"Telegram {method} error: {type(exc).__name__}: {exc}")
        return False


def send_message(text: str, reply_markup: Optional[dict] = None) -> bool:
    if not is_configured():
        print("Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset)")
        return False
    payload = {
        "chat_id": config.TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _post("sendMessage", payload)


def apply_url(record: JobRecord) -> str:
    """Deep link into the portal's one-click apply, falling back to the job link."""
    if config.SITE_URL:
        return f"{config.SITE_URL}/index.html#apply-now={record_document_id(record)}"
    return record.link or ""


def send_alert(record: JobRecord) -> bool:
    """Send a single fresh-role alert with an Apply button."""
    fit = int(record.fit_score or 0)
    posted = (record.posted or record.posted_raw or "recently").strip()
    n = parse_applicant_count(record.applicant_count)
    applicants = f"{n} applicants" if n is not None else "few applicants"
    role = html.escape(record.role or "Role")
    company = html.escape(record.company or "")
    location = html.escape(record.location or "")
    link = apply_url(record)

    lines = [
        f"🔥 <b>{role}</b>" + (f" @ {company}" if company else ""),
        f"Fit {fit} · {html.escape(applicants)} · posted {html.escape(posted)}",
    ]
    if location:
        lines.append(location)
    text = "\n".join(lines)

    buttons = []
    if link:
        buttons.append({"text": "⚡ Apply now", "url": link})
    # Also offer the raw ATS listing so you can eyeball the original posting.
    if record.link and record.link != link:
        buttons.append({"text": "🔗 View listing", "url": record.link})
    reply_markup = {"inline_keyboard": [buttons]} if buttons else None
    return send_message(text, reply_markup=reply_markup)
