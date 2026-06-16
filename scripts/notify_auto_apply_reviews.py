#!/usr/bin/env python3
"""Telegram GO/NO-GO pings for auto-apply roles queued for review.

Runs in GitHub Actions right after the scheduled auto-apply scan. The scan (a
Netlify `-background` function) is fire-and-forget — it returns 202 with no body
— so we can't read the queued roles from its response. Instead we read them
straight from Firestore: any job marked ``auto_apply_status == "review_pending"``
that hasn't been Telegram-notified yet.

Why here and not in the Netlify function: the bot token lives only as a GitHub
Actions secret, so the send has to happen where that secret is injected. The
decision endpoint already takes the HMAC token as a URL param, so Telegram inline
``url`` buttons drive GO/NO-GO with no webhook.

Dedup: each notified job gets ``auto_apply_telegram_sent: true`` so re-runs (and
the next digest cycle) never re-ping. That also makes the same-run timing race
harmless — anything the scan hasn't finished queuing yet is simply caught next
run. We still poll briefly so most alerts land in the same run.

Fails soft throughout: a notification problem must never break the digest job.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import os
import sys
import time

# Allow `python scripts/notify_auto_apply_reviews.py` from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.job_digest import config, notify_telegram  # noqa: E402
from scripts.job_digest.firestore import init_firestore_client  # noqa: E402

REVIEW_STATUS = "review_pending"
MAX_ROLES_PER_RUN = int(os.getenv("AUTO_APPLY_TELEGRAM_MAX", "10"))
# Poll for the async scan to finish marking jobs (it generates a CV per role).
# Kept short to save Actions minutes: the scan writes review_pending BEFORE CV
# generation, so fast roles appear within ~20s; anything slower is caught on the
# next run via the auto_apply_telegram_sent dedup flag (delayed, never lost).
POLL_SECONDS = int(os.getenv("AUTO_APPLY_TELEGRAM_POLL_SECONDS", "30"))
POLL_INTERVAL = 10


def _hmac_token(job_id: str) -> str:
    """Mirror the Netlify function's token: HMAC-SHA256(jobId) hex-encoded."""
    secret = os.getenv("AUTO_APPLY_HMAC_SECRET", "")
    if not secret:
        raise RuntimeError("AUTO_APPLY_HMAC_SECRET not set")
    return hmac.new(secret.encode("utf-8"), job_id.encode("utf-8"), hashlib.sha256).hexdigest()


def _decision_url(job_id: str, token: str, decision: str) -> str:
    base = (config.SITE_URL or "https://adejob.netlify.app").rstrip("/")
    return (
        f"{base}/.netlify/functions/auto-apply-decision"
        f"?jobId={job_id}&token={token}&decision={decision}"
    )


def _build_message(job: dict) -> tuple[str, dict]:
    esc = html.escape
    role = esc(job.get("role") or "Role")
    company = esc(job.get("company") or "")
    meta_bits = [f"Fit {int(job.get('fit_score') or 0)}/100"]
    if job.get("ats_family"):
        meta_bits.append(esc(str(job["ats_family"])))
    if job.get("salary_range"):
        meta_bits.append(esc(str(job["salary_range"])))

    text = "\n".join(
        [
            "🤖 <b>Auto-apply review</b>",
            f"<b>{role}</b>" + (f" @ {company}" if company else ""),
            " · ".join(meta_bits),
        ]
    )

    token = _hmac_token(job["id"])
    buttons = [
        [
            {"text": "✅ GO", "url": _decision_url(job["id"], token, "go")},
            {"text": "❌ NO-GO", "url": _decision_url(job["id"], token, "nogo")},
        ]
    ]
    link = job.get("link") or ""
    if str(link).startswith("http"):
        buttons.append([{"text": "🔗 View listing", "url": link}])
    return text, {"inline_keyboard": buttons}


def _pending_to_notify(client) -> list[dict]:
    """Jobs queued for review that haven't been Telegram-pinged yet."""
    coll = config.FIREBASE_COLLECTION
    out = []
    for snap in client.collection(coll).where("auto_apply_status", "==", REVIEW_STATUS).stream():
        data = snap.to_dict() or {}
        if data.get("auto_apply_telegram_sent") is True:
            continue
        data["id"] = snap.id
        out.append(data)
    # Freshest first; the email already carries the full pack, this is just a nudge.
    out.sort(key=lambda j: j.get("auto_apply_email_sent_at") or "", reverse=True)
    return out


def main() -> int:
    if not notify_telegram.is_configured():
        print("Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID unset) — skipping")
        return 0

    client = init_firestore_client()
    if client is None:
        print("Firestore not configured — skipping auto-apply Telegram pings")
        return 0

    # Poll briefly: the scan runs async and marks jobs as it finishes each CV.
    deadline = time.time() + POLL_SECONDS
    pending: list[dict] = []
    while True:
        pending = _pending_to_notify(client)
        if pending or time.time() >= deadline:
            break
        print(f"No review-pending roles yet; waiting {POLL_INTERVAL}s...")
        time.sleep(POLL_INTERVAL)

    if not pending:
        print("No new roles to notify.")
        return 0

    sent = 0
    for job in pending[:MAX_ROLES_PER_RUN]:
        try:
            text, reply_markup = _build_message(job)
            if notify_telegram.send_message(text, reply_markup=reply_markup):
                client.collection(config.FIREBASE_COLLECTION).document(job["id"]).set(
                    {
                        "auto_apply_telegram_sent": True,
                        "auto_apply_telegram_sent_at": config_now_iso(),
                    },
                    merge=True,
                )
                sent += 1
                print(f"Pinged: {job.get('role')} @ {job.get('company')} ({job['id']})")
            else:
                print(f"Telegram send failed for {job['id']} — will retry next run")
        except Exception as exc:  # noqa: BLE001 — fail soft, never break the job
            print(f"Error notifying {job.get('id')}: {type(exc).__name__}: {exc}")

    deferred = max(0, len(pending) - MAX_ROLES_PER_RUN)
    suffix = f" ({deferred} more deferred to next run)" if deferred else ""
    print(f"Done. Sent {sent}/{len(pending[:MAX_ROLES_PER_RUN])} ping(s){suffix}.")
    return 0


def config_now_iso() -> str:
    # Local import keeps the dependency obvious and the top of file light.
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
