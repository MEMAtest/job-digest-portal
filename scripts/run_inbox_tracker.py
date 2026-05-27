#!/usr/bin/env python3
"""Entry point for the inbox-mining application tracker.

Invoked from the GitHub Actions workflow. Local runs work too if SMTP_USER /
SMTP_PASS are exported in the environment.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from job_digest.inbox_tracker import run_inbox_tracker


def main() -> int:
    parser = argparse.ArgumentParser(description="Mine the personal Gmail inbox for job application evidence.")
    parser.add_argument("--since", required=True, help="ISO date (YYYY-MM-DD) — only mail after this date is scanned.")
    parser.add_argument("--out", default="artefacts/applications.json", help="Path to write the JSON artefact.")
    parser.add_argument("--dry-run", action="store_true", help="Skip all Firestore writes; only emit the artefact and summary.")
    parser.add_argument("--commit-writes", action="store_true", help="Explicit opt-in to Firestore writes (default is dry-run).")
    parser.add_argument("--max-messages", type=int, default=0, help="Cap on UIDs to process (0 = no cap).")
    args = parser.parse_args()

    dry_run = True
    if args.commit_writes and not args.dry_run:
        dry_run = False
    if args.dry_run:
        dry_run = True

    out_path = str(Path(args.out).resolve())
    result = run_inbox_tracker(
        since=args.since,
        out_path=out_path,
        dry_run=dry_run,
        max_messages=args.max_messages,
    )
    return 0 if result.events or result.candidates_fetched == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
