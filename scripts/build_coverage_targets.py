#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

from job_digest.company_coverage import (
    REGISTRY_PATH,
    build_registry_rows,
    compute_coverage_summary,
    read_registry,
    sync_generated_targets,
    write_registry,
)
from job_digest.firestore import write_company_coverage_snapshot


def load_env(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key not in os.environ:
            os.environ[key] = value


def main() -> None:
    load_env(REPO_ROOT / 'scripts' / '.env')
    parser = argparse.ArgumentParser(description='Build canonical company coverage registry and derived targets')
    parser.add_argument('--rebuild-registry', action='store_true', help='Rebuild the canonical registry from current inputs and curated extras')
    parser.add_argument('--print-summary', action='store_true', help='Print a JSON summary after generation')
    args = parser.parse_args()

    rows = None
    if args.rebuild_registry or not REGISTRY_PATH.exists():
        rows = build_registry_rows()
        write_registry(rows)

    result = sync_generated_targets(rows)
    registry_rows = rows or read_registry()
    summary = compute_coverage_summary(registry_rows)

    print(f"Registry: {result['registry_count']} firms")
    print(f"Feeds: {result['feed_rows']} rows")
    print(f"Search targets: {result['search_targets']} names")
    print(f"Runtime feeds path: {result['runtime_feeds_path']}")
    print(f"Runtime targets path: {result['runtime_targets_path']}")
    write_company_coverage_snapshot()
    if args.print_summary:
        print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
