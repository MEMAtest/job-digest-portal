#!/usr/bin/env python3
"""Audit source counts from Firestore job_stats."""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))


def load_env(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    load_env(REPO_ROOT / "scripts" / ".env")

    from job_digest.firestore import init_firestore_client
    from job_digest import config

    client = init_firestore_client()
    if client is None:
        print("Firestore unavailable. Check FIREBASE_SERVICE_ACCOUNT_JSON/B64 in scripts/.env.")
        return

    try:
        stats_docs = list(
            client.collection("job_stats")
            .order_by("date", direction="DESCENDING")
            .limit(7)
            .stream()
        )
    except Exception as exc:
        print(f"Failed to load job_stats: {exc}")
        return

    if not stats_docs:
        print("No job_stats documents found.")
        return

    stats = [doc.to_dict() or {} for doc in stats_docs]
    stats = sorted(stats, key=lambda d: d.get("date", ""))
    dates = [d.get("date") for d in stats]
    print("Dates:", ", ".join([d for d in dates if d]))

    def print_summary(label: str, counts: dict[str, int], total: int) -> None:
        print(f"\n{label} (total {total})")
        for source, count in sorted(counts.items(), key=lambda x: x[1], reverse=True):
            share = (count / total * 100) if total else 0
            print(f"{source}\t{count}\t{share:.1f}%")

    last = stats[-1]
    last_counts = last.get("counts") or {}
    last_total = last.get("total") or sum(last_counts.values())
    print_summary(f"Last day {last.get('date')}", last_counts, last_total)

    last3 = stats[-3:] if len(stats) >= 3 else stats
    agg = defaultdict(int)
    agg_total = 0
    for item in last3:
        counts = item.get("counts") or {}
        total = item.get("total") or sum(counts.values())
        agg_total += total
        for source, count in counts.items():
            agg[source] += count
    print_summary(f"Last {len(last3)} days", dict(agg), agg_total)

    if len(stats) >= 2:
        prev = stats[-2]
        prev_counts = prev.get("counts") or {}
        print(f"\nChange vs previous day ({prev.get('date')} -> {last.get('date')})")
        all_sources = set(prev_counts) | set(last_counts)
        for source in sorted(all_sources):
            prev_val = prev_counts.get(source, 0)
            curr_val = last_counts.get(source, 0)
            change = None
            if prev_val:
                change = (curr_val - prev_val) / prev_val * 100
            change_str = "n/a" if change is None else f"{change:+.1f}%"
            print(f"{source}\t{curr_val}\tprev:{prev_val}\tchange:{change_str}")


if __name__ == "__main__":
    main()
