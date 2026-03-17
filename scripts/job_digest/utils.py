from __future__ import annotations

import json
import re
import time
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import config
from .models import JobRecord

try:
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001
    ZoneInfo = None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


ATS_FAMILY_SOURCES = {"Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Workday", "Workable"}
AGGREGATOR_SOURCES = {"LinkedIn"}
MANUAL_SOURCES = {"Manual"}
RECRUITER_NAME_PATTERNS = (
    "recruit",
    "talent",
    "staff",
    "staffing",
    "jobs",
    "resourcing",
    "search",
    "headhunt",
    "careerwise",
    "twenty84",
    "arc it",
    "wiser",
    "jack & jill",
)


def infer_ats_family(source: str) -> str:
    source_value = (source or "").strip()
    return source_value if source_value in ATS_FAMILY_SOURCES else ""


def infer_source_family(source: str) -> str:
    source_value = (source or "").strip()
    if source_value in MANUAL_SOURCES:
        return "Manual"
    if source_value in ATS_FAMILY_SOURCES:
        return "ATS"
    if source_value in AGGREGATOR_SOURCES:
        return "Aggregator"
    if source_value:
        return "JobBoard"
    return ""


@lru_cache(maxsize=1)
def _target_firm_names() -> set[str]:
    from .company_coverage import read_registry

    return {
        (row.get("firm_name") or "").strip()
        for row in read_registry()
        if (row.get("firm_name") or "").strip()
    }


def canonicalize_company_name(name: str) -> str:
    from .company_coverage import canonicalize_name

    return canonicalize_name(name or "")


def is_target_firm(name: str) -> bool:
    canonical = canonicalize_company_name(name)
    return bool(canonical and canonical in _target_firm_names())


def looks_like_recruiter(name: str) -> bool:
    lowered = normalize_text(name or "").lower()
    if not lowered:
        return False
    return any(token in lowered for token in RECRUITER_NAME_PATTERNS)


def should_keep_role_company(company: str, source_family: str, source: str) -> bool:
    canonical = canonicalize_company_name(company)
    if source_family in {"ATS", "Manual"}:
        return bool(canonical or normalize_text(company))
    if not canonical:
        return False
    if is_target_firm(canonical):
        return True
    if source_family in {"JobBoard", "Aggregator"} and looks_like_recruiter(company):
        return False
    return False


def trim_summary(text: str) -> str:
    if not text:
        return ""
    return normalize_text(text)[: config.SUMMARY_MAX_CHARS]


RELATIVE_DATE_REGEX = re.compile(
    r"(reposted\s+\d+\s+days?\s+ago|\d+\s+days?\s+ago|\d+\s+hours?\s+ago|\d+\s+minutes?\s+ago|yesterday|today|new)",
    re.IGNORECASE,
)


def extract_relative_posted_text(text: str) -> str:
    if not text:
        return ""
    match = RELATIVE_DATE_REGEX.search(text)
    if match:
        return match.group(0)
    return ""


def parse_posted_date_value(posted_date: str) -> Optional[datetime]:
    if not posted_date:
        return None
    try:
        cleaned = posted_date.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        try:
            dt = parsedate_to_datetime(posted_date)
        except (TypeError, ValueError):
            if posted_date.isdigit():
                try:
                    ts = int(posted_date)
                    if ts > 10_000_000_000:
                        ts = ts / 1000
                    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                except (ValueError, OSError):
                    return None
            else:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def canonicalize_posted_fields(posted_text: str, posted_date: str) -> Tuple[str, str, str]:
    raw_text = normalize_text(posted_text or "")
    relative_text = extract_relative_posted_text(raw_text)
    parsed_date = parse_posted_date_value(posted_date or "")
    normalized_date = parsed_date.isoformat() if parsed_date else ""

    canonical_raw = relative_text if not normalized_date else ""
    canonical_display = normalized_date or canonical_raw or raw_text
    return canonical_display, canonical_raw, normalized_date


def clean_link(url: str) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        return parsed._replace(fragment="").geturl()
    except Exception:
        return url


def parse_applicant_count(value: str) -> Optional[int]:
    if not value:
        return None
    match = re.search(r"(\d[\d,]*)", value)
    if not match:
        return None
    try:
        return int(match.group(1).replace(",", ""))
    except ValueError:
        return None


def load_seen_cache(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def prune_seen_cache(seen: Dict[str, str], max_age_days: int) -> Dict[str, str]:
    if not seen:
        return {}
    cutoff = now_utc() - timedelta(days=max_age_days)
    keep: Dict[str, str] = {}
    for link, ts in seen.items():
        try:
            dt = datetime.fromisoformat(ts)
        except Exception:
            dt = None
        if not dt or dt >= cutoff:
            keep[link] = ts
    return keep


def save_seen_cache(path: Path, seen: Dict[str, str]) -> None:
    try:
        path.write_text(json.dumps(seen, indent=2))
    except Exception:
        return


def filter_new_records(records: List[JobRecord], seen: Dict[str, str]) -> List[JobRecord]:
    fresh: List[JobRecord] = []
    for rec in records:
        if rec.link and rec.link in seen:
            continue
        fresh.append(rec)
    return fresh


def select_top_pick(records: List[JobRecord]) -> Optional[JobRecord]:
    if not records:
        return None
    return max(records, key=lambda r: (r.fit_score, len(r.why_fit or "")))


def load_run_state(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def save_run_state(path: Path, state: Dict[str, str]) -> None:
    try:
        path.write_text(json.dumps(state, indent=2))
    except Exception:
        return


def _parse_run_time(value: str) -> Optional[Tuple[int, int]]:
    if not value:
        return None
    try:
        parts = value.split(":")
        return int(parts[0]), int(parts[1])
    except Exception:
        return None


def should_run_now(force: bool = False) -> bool:
    if force or config.FORCE_RUN:
        return True

    run_times = []
    if config.RUN_AT:
        run_times.append(config.RUN_AT)
    if config.RUN_ATS:
        run_times.extend(config.RUN_ATS)
    if not run_times:
        return True
    if ZoneInfo is None:
        return True

    tz = ZoneInfo(config.TZ_NAME)
    now_local = datetime.now(tz)
    state = load_run_state(config.RUN_STATE_PATH)
    last_slots = state.get("last_run_slots", [])
    if not isinstance(last_slots, list):
        last_slots = []

    for run_time in run_times:
        parsed = _parse_run_time(run_time)
        if not parsed:
            continue
        target_hour, target_minute = parsed
        target = now_local.replace(
            hour=target_hour,
            minute=target_minute,
            second=0,
            microsecond=0,
        )
        delta_minutes = abs((now_local - target).total_seconds()) / 60.0
        if delta_minutes > config.RUN_WINDOW_MINUTES:
            continue
        slot_key = f"{now_local.strftime('%Y-%m-%d')}-{target_hour:02d}:{target_minute:02d}"
        if slot_key in last_slots:
            continue
        return True

    return False


def parse_posted_within_window(posted_text: str, posted_date: str, window_hours: int) -> bool:
    text = (posted_text or "").lower().strip()
    if text == "new" or "newly posted" in text:
        return True
    if "just now" in text or "today" in text:
        return True
    if "yesterday" in text:
        return window_hours >= 24
    match = re.search(r"(\d+)", text)
    number = int(match.group(1)) if match else None

    if "minute" in text or "min" in text:
        return True
    if "hour" in text and number is not None:
        return number <= window_hours
    if "day" in text and number is not None:
        return (number * 24) <= window_hours
    if "week" in text and number is not None:
        return (number * 7 * 24) <= window_hours

    if posted_date:
        dt = parse_posted_date_value(posted_date)
        if not dt:
            return False
        return (now_utc() - dt) <= timedelta(hours=window_hours)

    return False
