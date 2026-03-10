#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

from job_digest.company_coverage import REGISTRY_PATH, compute_coverage_summary, read_registry


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
    rows = read_registry(REGISTRY_PATH)
    if not rows:
        print('No company coverage registry found.')
        raise SystemExit(1)

    summary = compute_coverage_summary(rows)
    print('Company coverage summary')
    print(json.dumps(summary, indent=2))

    try:
        from job_digest.firestore import init_firestore_client
        from job_digest import config
    except Exception:
        return

    client = init_firestore_client()
    if client is None:
        return

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    role_count = 0
    company_counter = Counter()
    try:
        for snap in client.collection(config.FIREBASE_COLLECTION).where('updated_at', '>=', cutoff).stream():
            data = snap.to_dict() or {}
            company = (data.get('company') or '').strip()
            if not company:
                continue
            role_count += 1
            company_counter[company] += 1
    except Exception as exc:
        print(f'Failed to read jobs for 7-day yield: {exc}')
        return

    print('\n7-day yield')
    print(f'Roles seen: {role_count}')
    print(f'Companies with roles: {len(company_counter)}')
    for company, count in company_counter.most_common(20):
        print(f'{company}\t{count}')


if __name__ == '__main__':
    main()
