#!/usr/bin/env python3
"""Post-delivery sweep: guarantee every recent "Daily Job Digest" email is filed
under the Job Digest label — and out of the inbox when JOB_DIGEST_SKIP_INBOX is
set — regardless of whether it was delivered via IMAP APPEND (which labels) or
the SMTP fallback (which does not). Run as a final step of the digest workflow.

Idempotent and bounded to recent mail (last few days) so it stays cheap.
"""

from __future__ import annotations

import imaplib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.job_digest import config  # noqa: E402
from scripts.job_digest.inbox_tracker import _find_all_mail_folder, _x_gm_search  # noqa: E402

LABEL = (os.getenv("JOB_DIGEST_INBOX_LABEL") or "Job Digest").strip()
SKIP_INBOX = (os.getenv("JOB_DIGEST_SKIP_INBOX") or "").strip().lower() in {"1", "true", "yes", "y", "on"}
LOOKBACK = os.getenv("JOB_DIGEST_LABEL_SWEEP_LOOKBACK", "3d")
QUERY = f'subject:"Daily Job Digest" newer_than:{LOOKBACK}'


def main() -> int:
    if not config.SMTP_USER or not config.SMTP_PASS:
        print("digest-label-sweep: SMTP_USER/PASS not set; skipping")
        return 0
    try:
        imap = imaplib.IMAP4_SSL("imap.gmail.com")
        imap.login(config.SMTP_USER, config.SMTP_PASS)
    except Exception as exc:  # noqa: BLE001
        print(f"digest-label-sweep: IMAP login failed: {type(exc).__name__}: {exc}")
        return 0

    labelled = 0
    archived = 0
    try:
        # 1) Apply the label (in All Mail) to any recent digest missing it.
        imap.select(_find_all_mail_folder(imap))
        quoted = f'"{LABEL}"'
        for uid in _x_gm_search(imap, QUERY):
            typ, data = imap.uid("FETCH", uid, "(X-GM-LABELS)")
            meta = b"".join([x[0] if isinstance(x, tuple) else x for x in (data or [])])
            if LABEL.encode() in meta:
                continue
            typ, _ = imap.uid("STORE", uid, "+X-GM-LABELS", quoted)
            if typ == "OK":
                labelled += 1

        # 2) When skip-inbox is on, remove recent digests from the inbox. The
        # \Deleted+EXPUNGE in INBOX context drops only the Inbox label; the
        # message stays in All Mail with the Job Digest label intact.
        if SKIP_INBOX:
            imap.select("INBOX")
            in_uids = _x_gm_search(imap, QUERY + " in:inbox")
            for uid in in_uids:
                typ, _ = imap.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
                if typ == "OK":
                    archived += 1
            if archived:
                imap.expunge()
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    print(f"digest-label-sweep: label={LABEL!r} skip_inbox={SKIP_INBOX} "
          f"newly_labelled={labelled} removed_from_inbox={archived}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
