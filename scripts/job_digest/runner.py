from __future__ import annotations

import argparse
import csv
import json
import os
import re
import signal
import statistics
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from . import config
from .boards import JOB_BOARD_SOURCES
from .company_coverage import read_registry
from .firestore import (
    backfill_posted_dates,
    backfill_role_summaries,
    cleanup_stale_jobs,
    diagnose_backfill,
    fetch_manual_link_requests,
    init_firestore_client,
    record_document_id,
    run_smoke_test,
    write_candidate_prep,
    write_notifications,
    write_records_to_firestore,
    write_role_suggestions,
    write_source_stats,
)
from .llm import enhance_records_with_groq
from .models import JobRecord
from .records import dedupe_records
from .scoring import (
    assess_fit,
    build_gaps,
    build_preference_match,
    build_reasons,
    is_relevant_location,
    is_relevant_title,
    is_relevant_title_direct,
    score_fit,
)
from .custom_careers import custom_careers_search as direct_custom_careers_search
from .sources import (
    adzuna_search,
    ashby_search,
    build_manual_record,
    builtin_london_search,
    custom_careers_search,
    cvlibrary_search,
    efinancialcareers_search,
    greenhouse_search,
    html_board_search,
    indeed_search,
    job_board_search,
    jobicy_search,
    jobserve_search,
    jooble_search,
    lever_search,
    linkedin_job_details,
    linkedin_search,
    meetfrank_search,
    get_source_runtime_events,
    reed_search,
    remotive_search,
    reset_source_runtime_events,
    remoteok_search,
    rss_search,
    save_custom_careers_health_state,
    smartrecruiters_search,
    technojobs_search,
    weloveproduct_search,
    workable_search,
    workday_search,
    workinstartups_search,
)
from .summary import build_email_html, build_sources_summary, send_email
from .utils import (
    canonicalize_company_name,
    canonicalize_posted_fields,
    canonical_job_link,
    compute_priority_score,
    due_run_slot,
    filter_new_records,
    is_target_firm,
    load_run_state,
    load_seen_cache,
    now_utc,
    parse_posted_within_window,
    prune_seen_cache,
    save_run_state,
    save_seen_cache,
    select_hot_lane,
    select_top_pick,
    should_keep_role_company,
)


def normalize_posted(job: dict) -> tuple[str, str, str]:
    return canonicalize_posted_fields(job.get("posted_text", "") or job.get("posted", ""), job.get("posted_date", ""))


def canonical_company(company: str) -> str:
    canonical = canonicalize_company_name(company)
    return canonical or (company or "").strip()


SOURCE_STAGE_TIMEOUT_SECONDS = int(os.getenv("JOB_DIGEST_SOURCE_STAGE_TIMEOUT", "180"))
RUNNER_TRACE_LOG = config.DIGEST_DIR / "runner_trace.log"
CUSTOM_CAREERS_MIN_SCORE = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_MIN_SCORE", "60") or "60")
SOURCE_DIAGNOSTICS_ENABLED = os.getenv("JOB_DIGEST_CUSTOM_DIAGNOSTICS", "false").lower() == "true"
SOURCE_DIAGNOSTICS_LIMIT = int(os.getenv("JOB_DIGEST_CUSTOM_DIAGNOSTICS_LIMIT", "100") or "100")
SOURCE_DIAGNOSTIC_SAMPLE_LIMIT = max(1, min(SOURCE_DIAGNOSTICS_LIMIT, 5))
SOURCE_HEALTH_WEAK_YIELD_MIN_RAW = int(os.getenv("JOB_DIGEST_WEAK_YIELD_MIN_RAW", "10") or "10")
SOURCE_HEALTH_WEAK_YIELD_RATIO = float(os.getenv("JOB_DIGEST_WEAK_YIELD_RATIO", "0.15") or "0.15")
RECENT_DIGEST_SAMPLE_SIZE = int(os.getenv("JOB_DIGEST_FORECAST_SAMPLE_SIZE", "10") or "10")
LINKEDIN_DETAILS_DEADLINE_SECONDS = int(os.getenv("JOB_DIGEST_LINKEDIN_DETAILS_DEADLINE_SECONDS", "45") or "45")
LINKEDIN_DETAIL_TIMEOUT_SECONDS = int(os.getenv("JOB_DIGEST_LINKEDIN_DETAIL_TIMEOUT_SECONDS", "8") or "8")
LINKEDIN_MAX_DETAIL_JOBS = int(os.getenv("JOB_DIGEST_LINKEDIN_MAX_DETAIL_JOBS", "120") or "120")
SOURCE_DIAGNOSTICS: dict[str, dict] = {}
CUSTOM_CAREERS_TARGET_DIAGNOSTICS: dict[str, dict] = {}
RUN_SUMMARY: dict[str, object] = {}

CUSTOM_CAREERS_TITLE_HINTS = (
    "product",
    "onboarding",
    "kyc",
    "aml",
    "screening",
    "financial crime",
    "fraud",
    "compliance",
    "risk",
    "business analyst",
    "operations",
    "strategy",
    "transformation",
    "implementation",
    "lifecycle",
    "process owner",
    "product operations",
    "controls",
    "governance",
)

CUSTOM_CAREERS_GENERIC_TITLE_TERMS = (
    "job openings at",
    "job opportunities at",
    "search & apply",
    "search and apply",
    "careers",
    "career opportunities",
    "campus events",
    "join our team",
    "join us",
    "military spouses",
    "veterans",
)

SOURCE_STAGE_NAME_MAP = {
    "linkedin": "LinkedIn",
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "smartrecruiters": "SmartRecruiters",
    "ashby": "Ashby",
    "workable": "Workable",
    "workday": "Workday",
}


class SourceStageTimeoutError(TimeoutError):
    pass


def log_trace(message: str) -> None:
    line = f"{datetime.now(timezone.utc).isoformat()} {message}"
    print(line)
    try:
        with RUNNER_TRACE_LOG.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except Exception:
        pass


def _diagnostic_enabled_for(source_name: str) -> bool:
    if SOURCE_DIAGNOSTICS_ENABLED:
        return True
    return source_name in {
        "CustomCareers",
        "IndeedUK",
        "LinkedIn",
        "Greenhouse",
        "Lever",
        "SmartRecruiters",
        "Ashby",
        "Workable",
        "Workday",
    }


def reset_source_diagnostics() -> None:
    SOURCE_DIAGNOSTICS.clear()
    CUSTOM_CAREERS_TARGET_DIAGNOSTICS.clear()
    RUN_SUMMARY.clear()


def init_source_diagnostic(source_name: str, raw_count: int) -> dict:
    diag = SOURCE_DIAGNOSTICS.setdefault(
        source_name,
        {
            "source_name": source_name,
            "raw": 0,
            "kept": 0,
            "blocked": 0,
            "timed_out": 0,
            "failed": 0,
            "status": "empty",
            "pre_seen_kept": 0,
            "post_seen_kept": 0,
            "seen_filtered": 0,
            "mode": "",
            "query_count": 0,
            "page_count": 0,
            "company_query_count": 0,
            "adjacent_query_count": 0,
            "notes": [],
            "dropped": {"title": 0, "location": 0, "company": 0, "window": 0, "score": 0},
            "examples": {"title": [], "location": [], "company": [], "window": [], "score": [], "kept": []},
        },
    )
    diag["raw"] = raw_count
    return diag


def add_source_diagnostic_example(diag: dict, category: str, payload: dict) -> None:
    if not _diagnostic_enabled_for(diag.get("source_name", "")):
        return
    examples = diag["examples"].setdefault(category, [])
    if len(examples) < SOURCE_DIAGNOSTIC_SAMPLE_LIMIT:
        examples.append(payload)


def add_source_note(diag: dict, note: str) -> None:
    notes = diag.setdefault("notes", [])
    if note and note not in notes:
        notes.append(note)


def normalize_source_name(label: str) -> str:
    if label.startswith("job_board:"):
        return label.split(":", 1)[1]
    return SOURCE_STAGE_NAME_MAP.get(label, label)


def classify_source_diagnostic(diag: dict) -> str:
    raw = int(diag.get("raw", 0) or 0)
    kept = int(diag.get("kept", 0) or 0)
    blocked = int(diag.get("blocked", 0) or 0)
    timed_out = int(diag.get("timed_out", 0) or 0)
    failed = int(diag.get("failed", 0) or 0)
    if blocked > 0:
        return "blocked"
    if timed_out > 0:
        return "timed_out"
    if failed > 0:
        return "broken"
    if raw <= 0 and kept <= 0:
        return "empty"
    if raw >= SOURCE_HEALTH_WEAK_YIELD_MIN_RAW and raw > 0 and (kept / raw) < SOURCE_HEALTH_WEAK_YIELD_RATIO:
        return "weak_yield"
    return "healthy"


def merge_runtime_source_events() -> None:
    runtime_events = get_source_runtime_events()
    for source_name, event in runtime_events.items():
        diag = init_source_diagnostic(source_name, int(event.get("raw", 0) or 0))
        diag["blocked"] = max(int(diag.get("blocked", 0) or 0), int(event.get("blocked", 0) or 0))
        diag["timed_out"] = max(int(diag.get("timed_out", 0) or 0), int(event.get("timed_out", 0) or 0))
        diag["failed"] = max(int(diag.get("failed", 0) or 0), int(event.get("failed", 0) or 0))
        diag["raw"] = max(int(diag.get("raw", 0) or 0), int(event.get("raw", 0) or 0))
        if event.get("mode"):
            diag["mode"] = event.get("mode")
        diag["query_count"] = max(int(diag.get("query_count", 0) or 0), int(event.get("query_count", 0) or 0))
        diag["page_count"] = max(int(diag.get("page_count", 0) or 0), int(event.get("page_count", 0) or 0))
        diag["company_query_count"] = max(
            int(diag.get("company_query_count", 0) or 0), int(event.get("company_query_count", 0) or 0)
        )
        diag["adjacent_query_count"] = max(
            int(diag.get("adjacent_query_count", 0) or 0), int(event.get("adjacent_query_count", 0) or 0)
        )
        for note in event.get("notes", []) or []:
            add_source_note(diag, note)
    for source_name, diag in SOURCE_DIAGNOSTICS.items():
        diag["source_name"] = source_name
        diag["status"] = classify_source_diagnostic(diag)


def update_seen_cache_summary(pre_seen_records: list[JobRecord], post_seen_records: list[JobRecord]) -> None:
    post_seen_links = {record.link for record in post_seen_records if record.link}
    for diag in SOURCE_DIAGNOSTICS.values():
        diag["pre_seen_kept"] = 0
        diag["post_seen_kept"] = 0
        diag["seen_filtered"] = 0
    for record in pre_seen_records:
        diag = init_source_diagnostic(record.source or "Unknown", SOURCE_DIAGNOSTICS.get(record.source or "Unknown", {}).get("raw", 0))
        diag["pre_seen_kept"] = int(diag.get("pre_seen_kept", 0) or 0) + 1
        if not record.link or record.link in post_seen_links:
            diag["post_seen_kept"] = int(diag.get("post_seen_kept", 0) or 0) + 1
    for diag in SOURCE_DIAGNOSTICS.values():
        diag["seen_filtered"] = max(0, int(diag.get("pre_seen_kept", 0) or 0) - int(diag.get("post_seen_kept", 0) or 0))

    RUN_SUMMARY["pre_seen_kept"] = len(pre_seen_records)
    RUN_SUMMARY["post_seen_kept"] = len(post_seen_records)
    RUN_SUMMARY["seen_filtered"] = max(0, len(pre_seen_records) - len(post_seen_records))


def print_seen_cache_summary(*, validation_digest_path: str = "") -> None:
    pre_seen = int(RUN_SUMMARY.get("pre_seen_kept", 0) or 0)
    post_seen = int(RUN_SUMMARY.get("post_seen_kept", 0) or 0)
    seen_filtered = int(RUN_SUMMARY.get("seen_filtered", 0) or 0)
    print("\n--- Seen Cache Summary ---")
    print(f"  pre_seen_kept={pre_seen}")
    print(f"  post_seen_kept={post_seen}")
    print(f"  seen_filtered={seen_filtered}")
    if validation_digest_path:
        print(f"  validation_digest={validation_digest_path}")
    print("--- End Seen Cache Summary ---")
    log_trace(
        f"[seen] pre_seen_kept={pre_seen} post_seen_kept={post_seen} "
        f"seen_filtered={seen_filtered} validation_digest={validation_digest_path or 'none'}"
    )


def _init_custom_target_diagnostic(job: dict, company: str) -> dict | None:
    careers_url = (job.get("target_careers_url") or "").strip()
    if not careers_url:
        return None
    stats = CUSTOM_CAREERS_TARGET_DIAGNOSTICS.setdefault(
        careers_url,
        {
            "firm": (job.get("target_firm") or company or "").strip(),
            "careers_url": careers_url,
            "primary_category": (job.get("target_category") or "").strip(),
            "raw": 0,
            "kept": 0,
            "dropped": {"title": 0, "location": 0, "company": 0, "window": 0, "score": 0},
        },
    )
    if company and not stats.get("firm"):
        stats["firm"] = company
    return stats


def finalize_custom_target_diagnostics() -> dict[str, dict]:
    finalized: dict[str, dict] = {}
    stamped_at = datetime.now(timezone.utc).isoformat()
    for careers_url, stats in CUSTOM_CAREERS_TARGET_DIAGNOSTICS.items():
        raw = int(stats.get("raw", 0) or 0)
        kept = int(stats.get("kept", 0) or 0)
        if raw <= 0:
            status = "empty"
        elif raw >= SOURCE_HEALTH_WEAK_YIELD_MIN_RAW and (kept / raw) < SOURCE_HEALTH_WEAK_YIELD_RATIO:
            status = "weak_yield"
        elif kept > 0:
            status = "healthy"
        else:
            status = "empty"
        finalized[careers_url] = {
            **stats,
            "last_status": status,
            "last_seen_at": stamped_at,
            "last_raw": raw,
            "last_kept": kept,
        }
    return finalized


def print_source_health_summary() -> None:
    merge_runtime_source_events()
    order = {"blocked": 0, "timed_out": 1, "broken": 2, "weak_yield": 3, "healthy": 4, "empty": 5}
    print("\n--- Source Health ---")
    if not SOURCE_DIAGNOSTICS:
        print("  (no source diagnostics recorded)")
        print("--- End Source Health ---")
        return
    for source_name, diag in sorted(
        SOURCE_DIAGNOSTICS.items(),
        key=lambda item: (order.get(item[1].get("status", "empty"), 9), item[0].lower()),
    ):
        parts = [f"raw={int(diag.get('raw', 0) or 0)}", f"kept={int(diag.get('kept', 0) or 0)}"]
        if diag.get("pre_seen_kept"):
            parts.append(f"pre_seen={int(diag.get('pre_seen_kept', 0) or 0)}")
        if diag.get("post_seen_kept") or diag.get("pre_seen_kept"):
            parts.append(f"post_seen={int(diag.get('post_seen_kept', 0) or 0)}")
        if diag.get("seen_filtered"):
            parts.append(f"seen_filtered={int(diag.get('seen_filtered', 0) or 0)}")
        if diag.get("mode"):
            parts.append(f"mode={diag['mode']}")
        if diag.get("query_count"):
            parts.append(f"queries={diag['query_count']}")
        if diag.get("page_count"):
            parts.append(f"pages={diag['page_count']}")
        if diag.get("company_query_count"):
            parts.append(f"company_queries={diag['company_query_count']}")
        if diag.get("adjacent_query_count"):
            parts.append(f"adjacent_queries={diag['adjacent_query_count']}")
        if diag.get("blocked"):
            parts.append(f"blocked={diag['blocked']}")
        if diag.get("timed_out"):
            parts.append(f"timed_out={diag['timed_out']}")
        dropped = diag.get("dropped", {})
        for key in ("title", "location", "company", "window", "score"):
            value = int(dropped.get(key, 0) or 0)
            if value:
                parts.append(f"{key}={value}")
        print(f"  {source_name:<18} {diag.get('status', 'empty'):<10} {' '.join(parts)}")
        log_trace(f"[health] {source_name} status={diag.get('status', 'empty')} {' '.join(parts)}")
    print("--- End Source Health ---")


def min_score_for_fit(fit: dict, source_family: str, source: str) -> int:
    min_score = config.MIN_SCORE
    role_family = str(fit.get("role_family", "stretch"))
    domain_anchor = bool(fit.get("domain_anchor"))
    negative_hits = list(fit.get("negative_hits", []))

    if source_family == "ATS":
        if role_family == "core":
            return 60
        if role_family == "adjacent":
            return 62 if domain_anchor else 66
        return min_score

    if source == "CustomCareers":
        return CUSTOM_CAREERS_MIN_SCORE

    if source_family == "Aggregator":
        return 70 if domain_anchor else 75

    if source_family == "JobBoard":
        if negative_hits:
            return max(min_score, 75)
        return 70 if domain_anchor else 75

    return min_score


DIRECT_ATS_SOURCES = {"Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Workable", "Workday", "DirectCareers"}


def keep_score_threshold(source_family: str, source: str) -> int:
    if source == "CustomCareers":
        return min(CUSTOM_CAREERS_MIN_SCORE, config.EMAIL_BORDERLINE_MIN_SCORE)
    if source_family == "ATS" and source in DIRECT_ATS_SOURCES:
        # Direct ATS only returns roles from registered target firms, so the
        # company gate is implicit. The LinkedIn-tuned EMAIL_BORDERLINE_MIN_SCORE
        # is too aggressive here. Drop the floor by 10 points (minimum 40).
        return max(40, config.EMAIL_BORDERLINE_MIN_SCORE - 10)
    if source_family in {"ATS", "JobBoard", "Aggregator"}:
        return config.EMAIL_BORDERLINE_MIN_SCORE
    return min(config.MIN_SCORE, config.EMAIL_BORDERLINE_MIN_SCORE)


def build_recent_digest_forecast() -> dict:
    digest_files = sorted(
        p for p in config.DIGEST_DIR.glob("digest_*.csv") if "scrape_only" not in p.name
    )[-RECENT_DIGEST_SAMPLE_SIZE:]
    counts: list[int] = []
    category_totals: Counter[str] = Counter()
    registry = {canonicalize_company_name(row.get("firm_name", "")): row for row in read_registry()}
    for path in digest_files:
        try:
            with path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
        except OSError:
            continue
        counts.append(len(rows))
        for row in rows:
            company = canonicalize_company_name(row.get("Company", "") or "")
            category = (registry.get(company, {}) or {}).get("primary_category") or "Unknown"
            category_totals[category] += 1
    if not counts:
        return {"runs": 0}
    runs = len(counts)
    return {
        "runs": runs,
        "average": round(statistics.mean(counts), 1),
        "median": round(statistics.median(counts), 1),
        "min": min(counts),
        "max": max(counts),
        "category_daily_average": {
            key: round(value / runs, 1) for key, value in category_totals.items() if key in {"Bank", "Fintech", "Regtech"}
        },
    }


def print_recent_digest_forecast() -> None:
    forecast = build_recent_digest_forecast()
    if not forecast.get("runs"):
        return
    print("\n--- Expected Roles ---")
    print(
        f"  rolling {forecast['runs']} runs: avg={forecast['average']} median={forecast['median']} "
        f"min={forecast['min']} max={forecast['max']}"
    )
    category_parts = [
        f"{category.lower()}={value}/day"
        for category, value in sorted(forecast.get("category_daily_average", {}).items())
    ]
    if category_parts:
        print(f"  category mix: {' | '.join(category_parts)}")
    print("--- End Expected Roles ---")


def build_source_diagnostics_artifact() -> dict[str, dict]:
    payload: dict[str, dict] = {}
    indeed_diag = SOURCE_DIAGNOSTICS.get("IndeedUK")
    if indeed_diag:
        payload["IndeedUK"] = {
            "mode": indeed_diag.get("mode") or "browser",
            "raw": int(indeed_diag.get("raw", 0) or 0),
            "kept": int(indeed_diag.get("kept", 0) or 0),
            "blocked_pages": int(indeed_diag.get("blocked", 0) or 0),
            "attempted_queries": int(indeed_diag.get("query_count", 0) or 0),
        }
    custom_diag = SOURCE_DIAGNOSTICS.get("CustomCareers")
    if custom_diag:
        custom_payload = {
            "raw": int(custom_diag.get("raw", 0) or 0),
            "kept": int(custom_diag.get("kept", 0) or 0),
            "dropped": {
                "title": int(custom_diag.get("dropped", {}).get("title", 0) or 0),
                "location": int(custom_diag.get("dropped", {}).get("location", 0) or 0),
                "company": int(custom_diag.get("dropped", {}).get("company", 0) or 0),
                "window": int(custom_diag.get("dropped", {}).get("window", 0) or 0),
                "score": int(custom_diag.get("dropped", {}).get("score", 0) or 0),
            },
        }
        samples = {
            key: list(custom_diag.get("examples", {}).get(key, []) or [])[:SOURCE_DIAGNOSTIC_SAMPLE_LIMIT]
            for key in ("title", "location", "company", "window", "score")
            if custom_diag.get("examples", {}).get(key)
        }
        if samples:
            custom_payload["samples"] = samples
        payload["CustomCareers"] = custom_payload
    return payload


def write_source_diagnostics(suffix: str = "") -> Path | None:
    merge_runtime_source_events()
    if not SOURCE_DIAGNOSTICS:
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_path = config.DIGEST_DIR / f"source_diagnostics_{today}{suffix}.json"
    try:
        RUN_SUMMARY["stage_timeout_hit"] = any(
            int(diag.get("timed_out", 0) or 0) > 0 for diag in SOURCE_DIAGNOSTICS.values()
        )
        payload = dict(SOURCE_DIAGNOSTICS)
        payload["__run__"] = dict(RUN_SUMMARY)
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        log_trace(f"[step] source diagnostics written to {output_path}")
        return output_path
    except Exception as exc:
        log_trace(f"[step] source diagnostics write failed: {exc}")
        return None


def is_custom_careers_relevant_title(title: str, company: str, summary: str = "") -> bool:
    title_l = (title or "").lower()
    if any(term in title_l for term in CUSTOM_CAREERS_GENERIC_TITLE_TERMS):
        return False
    if is_relevant_title(title):
        return True
    if not is_target_firm(company):
        return False
    combined = f"{title} {summary}".lower()
    return any(term in combined for term in CUSTOM_CAREERS_TITLE_HINTS)


def is_custom_careers_relevant_location(location: str, summary: str, company: str) -> bool:
    if is_relevant_location(location, summary):
        return True
    if not is_target_firm(company):
        return False
    combined = f"{location} {summary}".lower()
    return not location.strip() or any(
        term in combined for term in ("remote", "hybrid", "uk", "united kingdom", "england", "scotland", "wales", "london")
    )


def is_direct_ats_relevant_location(location: str, summary: str, company: str) -> bool:
    if is_relevant_location(location, summary):
        return True
    if not is_target_firm(company):
        return False
    normalized_location = (location or "").strip().lower()
    combined = f"{location} {summary}".lower()
    if not normalized_location:
        return True
    if re.fullmatch(r"\d+\s+locations?", normalized_location):
        return True
    if any(term in combined for term in ("multiple locations", "various locations", "hybrid", "remote")):
        return True
    return any(term in combined for term in ("uk", "united kingdom", "england", "scotland", "wales", "london"))


def is_direct_ats_within_window(posted_display: str, posted_raw: str, posted_date: str, company: str) -> bool:
    if parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
        return True
    return is_target_firm(company) and not posted_raw and not posted_date


def is_linkedin_within_window(posted_display: str, posted_raw: str, posted_date: str, company: str) -> bool:
    if parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
        return True
    if is_target_firm(company):
        if not posted_raw and not posted_date:
            return True
        return parse_posted_within_window(
            posted_raw or posted_display,
            posted_date,
            max(config.WINDOW_HOURS, config.LINKEDIN_TARGET_WINDOW_HOURS),
        )
    return False


def is_linkedin_included_company(company: str) -> bool:
    normalized = canonicalize_company_name(company).lower() or (company or "").strip().lower()
    return normalized in config.LINKEDIN_INCLUDED_COMPANIES


def should_keep_linkedin_company(company: str) -> bool:
    return should_keep_role_company(company, "Aggregator", "LinkedIn") or is_linkedin_included_company(company)


def run_step(label: str, fn):
    started = time.perf_counter()
    log_trace(f"[step] {label}...")
    result = fn()
    elapsed = time.perf_counter() - started
    log_trace(f"[step] {label} complete in {elapsed:.1f}s")
    return result


def _timeout_handler(_signum, _frame):
    raise SourceStageTimeoutError


def run_source_stage(label: str, fn):
    started = time.perf_counter()
    log_trace(f"[source] {label} starting...")
    source_name = normalize_source_name(label)
    previous_handler = signal.getsignal(signal.SIGALRM)
    try:
        if SOURCE_STAGE_TIMEOUT_SECONDS > 0:
            signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(SOURCE_STAGE_TIMEOUT_SECONDS)
        records = fn()
        elapsed = time.perf_counter() - started
        diag = init_source_diagnostic(source_name, SOURCE_DIAGNOSTICS.get(source_name, {}).get("raw", 0))
        diag["kept"] = max(int(diag.get("kept", 0) or 0), len(records))
        log_trace(f"[source] {label} complete in {elapsed:.1f}s with {len(records)} kept roles")
        return records
    except SourceStageTimeoutError:
        elapsed = time.perf_counter() - started
        diag = init_source_diagnostic(source_name, SOURCE_DIAGNOSTICS.get(source_name, {}).get("raw", 0))
        diag["timed_out"] += 1
        add_source_note(diag, f"{label} exceeded source stage timeout")
        log_trace(f"[source] {label} timed out after {elapsed:.1f}s; skipping")
        return []
    except Exception as exc:  # noqa: BLE001
        elapsed = time.perf_counter() - started
        diag = init_source_diagnostic(source_name, SOURCE_DIAGNOSTICS.get(source_name, {}).get("raw", 0))
        diag["failed"] += 1
        add_source_note(diag, f"{label} failed: {type(exc).__name__}")
        log_trace(f"[source] {label} failed after {elapsed:.1f}s: {type(exc).__name__}: {exc}")
        return []
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def write_digest_outputs(records: list[JobRecord], *, suffix: str = "") -> tuple[Path, Path]:
    def join_values(values) -> str:
        parts: list[str] = []
        for value in values or []:
            if value is None:
                continue
            if isinstance(value, str):
                text = value.strip()
            else:
                try:
                    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
                except TypeError:
                    text = str(value).strip()
            if text:
                parts.append(text)
        return " | ".join(parts)

    today = datetime.now().strftime("%Y-%m-%d")
    out_xlsx = config.DIGEST_DIR / f"digest_{today}{suffix}.xlsx"
    out_csv = config.DIGEST_DIR / f"digest_{today}{suffix}.csv"

    df = pd.DataFrame([
        {
            "Role": r.role,
            "Company": r.company,
            "Location": r.location,
            "Link": r.link,
            "Posted": r.posted,
            "Source": r.source,
            "Email_Bucket": r.email_bucket,
            "Fit_Score_%": r.fit_score,
            "Fit_Verdict": r.fit_verdict,
            "Preference_Match": r.preference_match,
            "Why_Fit": r.why_fit,
            "CV_Gap": r.cv_gap,
            "Role_Summary": r.role_summary,
            "Tailored_Summary": r.tailored_summary,
            "Tailored_CV_Bullets": join_values(r.tailored_cv_bullets),
            "Key_Requirements": join_values(r.key_requirements),
            "Match_Notes": r.match_notes,
            "Company_Insights": r.company_insights,
            "Cover_Letter": r.cover_letter,
            "Key_Talking_Points": join_values(r.key_talking_points),
            "STAR_Stories": join_values(r.star_stories),
            "Quick_Pitch": r.quick_pitch,
            "Interview_Focus": r.interview_focus,
            "Prep_Questions": join_values(r.prep_questions),
            "Prep_Answers": join_values(r.prep_answers),
            "Scorecard": join_values(r.scorecard),
            "Apply_Tips": r.apply_tips,
            "Notes": r.notes,
        }
        for r in records
    ])

    df.to_excel(out_xlsx, index=False)
    df.to_csv(out_csv, index=False)
    return out_xlsx, out_csv


def record_identity(record: JobRecord) -> str:
    canonical_link = canonical_job_link(record.link)
    if canonical_link:
        return f"link:{canonical_link}"
    return f"role:{record.company.lower()}::{record.role.lower()}::{record.location.lower()}"


def build_delivery_records(new_records: list[JobRecord], qualified_records: list[JobRecord]) -> list[JobRecord]:
    """Build the email/digest list and keep the visible block score-sorted."""
    max_roles = max(config.MAX_EMAIL_ROLES, config.MIN_EMAIL_ROLES)
    target_roles = min(max_roles, max(config.MIN_EMAIL_ROLES, len(new_records)))
    selected: list[JobRecord] = []
    selected_keys: set[str] = set()

    for record in list(new_records) + list(qualified_records):
        key = record_identity(record)
        if key in selected_keys:
            continue
        selected.append(record)
        selected_keys.add(key)
        if len(selected) >= target_roles:
            break

    return sorted(
        selected,
        key=lambda record: (
            int(record.fit_score or 0),
            record.company.lower(),
            record.role.lower(),
        ),
        reverse=True,
    )


def ensure_record_richness(records: list[JobRecord]) -> list[JobRecord]:
    """Guarantee every digest row has useful role/candidate detail even if LLM enrichment is partial."""
    for record in records:
        combined = f"{record.role} {record.company} {record.notes}".lower()
        requirements = []
        if any(term in combined for term in ("kyc", "aml", "screening", "fraud", "financial crime", "compliance", "risk")):
            requirements.extend([
                "Financial crime, compliance, risk, or controls product knowledge",
                "Ability to balance regulatory outcomes with customer and operational experience",
            ])
        if any(term in combined for term in ("payment", "card", "treasury", "ledger", "transaction", "banking")):
            requirements.extend([
                "Payments, banking, or transaction-platform product experience",
                "Strong control design and cross-functional delivery discipline",
            ])
        if any(term in combined for term in ("ai", "model", "automation", "data", "analytics")):
            requirements.extend([
                "Data-led product judgement and comfort with AI, automation, or analytics workflows",
            ])
        if any(term in combined for term in ("product manager", "product owner", "product lead", "head of product")):
            requirements.extend([
                "Product discovery, roadmap ownership, stakeholder alignment, and agile delivery",
            ])
        if not requirements:
            requirements.extend([
                "Relevant product ownership experience in regulated financial services",
                "Stakeholder management across business, technology, operations, and control teams",
            ])

        if not record.key_requirements:
            record.key_requirements = requirements[:5]

        if not record.role_summary:
            if record.notes:
                record.role_summary = record.notes[:900]
            else:
                record.role_summary = (
                    "Likely role focus: own product outcomes, prioritise roadmap decisions, manage delivery across "
                    "technology and business stakeholders, and translate regulatory/customer needs into scalable "
                    "platform improvements."
                )

        if not record.tailored_summary:
            record.tailored_summary = (
                "Ade's strongest angle is regulated fintech product delivery: KYC/onboarding, screening, fraud/risk "
                "controls, API/platform change, stakeholder leadership, and measurable operational improvement across "
                "multi-jurisdiction environments."
            )

        if not record.match_notes:
            record.match_notes = (
                "Match should be positioned around financial-crime product depth, platform delivery, regulatory change, "
                "and measurable outcomes from Vistra, Ebury, N26, Elucidate, and Fenergo work."
            )

        if not record.key_talking_points:
            record.key_talking_points = [
                "Standardised KYC/onboarding and screening controls across complex regulated environments",
                "Improved operational quality using automation, workflow redesign, and data-led prioritisation",
                "Led product/platform change across compliance, operations, engineering, and senior stakeholders",
            ]

        if not record.apply_tips:
            record.apply_tips = (
                "Lead the application with KYC/AML, onboarding, screening, fraud/risk, and platform delivery metrics; "
                "de-emphasise unrelated domain gaps unless the advert explicitly requires them."
            )

    return records


def print_source_yield(records: list[JobRecord]) -> None:
    merge_runtime_source_events()
    raw_by_source = {
        source_name: int(diag.get("raw", 0) or 0)
        for source_name, diag in sorted(SOURCE_DIAGNOSTICS.items())
        if int(diag.get("raw", 0) or 0) > 0
    }
    kept_by_source = {
        source_name: int(diag.get("kept", 0) or 0)
        for source_name, diag in sorted(SOURCE_DIAGNOSTICS.items())
        if int(diag.get("kept", 0) or 0) > 0
    }
    drop_reason_summary = {
        source_name: {
            key: int(diag.get("dropped", {}).get(key, 0) or 0)
            for key in ("title", "location", "company", "window", "score")
            if int(diag.get("dropped", {}).get(key, 0) or 0) > 0
        }
        for source_name, diag in sorted(SOURCE_DIAGNOSTICS.items())
        if any(int(diag.get("dropped", {}).get(key, 0) or 0) > 0 for key in ("title", "location", "company", "window", "score"))
    }
    top_companies = Counter(record.company for record in records if record.company).most_common(10)
    RUN_SUMMARY["raw_by_source"] = raw_by_source
    RUN_SUMMARY["kept_by_source"] = kept_by_source
    RUN_SUMMARY["drop_reason_summary"] = drop_reason_summary
    RUN_SUMMARY["top_companies_kept"] = dict(top_companies)

    print("\n--- Source Yield Summary ---")
    if raw_by_source:
        print("  raw_by_source:")
        for src, cnt in sorted(raw_by_source.items(), key=lambda item: (-item[1], item[0].lower())):
            print(f"    {src}: {cnt}")
    if kept_by_source:
        print("  kept_by_source:")
        for src, cnt in sorted(kept_by_source.items(), key=lambda item: (-item[1], item[0].lower())):
            print(f"    {src}: {cnt}")
    if drop_reason_summary:
        print("  drop_reason_summary:")
        for src, dropped in drop_reason_summary.items():
            parts = [f"{key}={value}" for key, value in dropped.items()]
            print(f"    {src}: {' '.join(parts)}")
    if top_companies:
        print("  top_companies_kept:")
        for company, cnt in top_companies:
            print(f"    {company}: {cnt}")
    else:
        print("  (no roles in digest this run)")
    print("--- End Source Summary ---")
    log_trace(f"[summary] raw_by_source={json.dumps(raw_by_source, sort_keys=True)}")
    log_trace(f"[summary] kept_by_source={json.dumps(kept_by_source, sort_keys=True)}")
    if drop_reason_summary:
        log_trace(f"[summary] drop_reason_summary={json.dumps(drop_reason_summary, sort_keys=True)}")
    log_trace(f"[summary] top_companies_kept={json.dumps(dict(top_companies), sort_keys=True)}")


def collect_linkedin_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    linkedin_jobs = linkedin_search(session)
    print(f"[LinkedIn] {len(linkedin_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("LinkedIn", len(linkedin_jobs))
    details_started = time.monotonic()
    detail_jobs_processed = 0

    def drop(reason: str, payload: dict) -> None:
        diag["dropped"][reason] += 1
        add_source_diagnostic_example(diag, reason, payload)

    def details_deadline_reached() -> bool:
        if LINKEDIN_DETAILS_DEADLINE_SECONDS <= 0:
            return False
        return (time.monotonic() - details_started) >= LINKEDIN_DETAILS_DEADLINE_SECONDS

    for job in linkedin_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        if not is_relevant_title(title):
            drop("title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        if LINKEDIN_MAX_DETAIL_JOBS > 0 and detail_jobs_processed >= LINKEDIN_MAX_DETAIL_JOBS:
            diag["timed_out"] += 1
            add_source_note(diag, "linkedin detail cap reached")
            log_trace("[source] linkedin detail cap reached; returning partial results")
            break
        if details_deadline_reached():
            diag["timed_out"] += 1
            add_source_note(diag, "linkedin detail deadline reached")
            log_trace("[source] linkedin detail deadline reached; returning partial results")
            break

        detail_timeout = max(3, LINKEDIN_DETAIL_TIMEOUT_SECONDS)
        detail = linkedin_job_details(session, job["job_id"], timeout=detail_timeout)
        detail_jobs_processed += 1
        desc_text = detail.get("description", "")
        if detail.get("title"):
            title = detail["title"]
        if detail.get("company"):
            company = detail["company"]
        if detail.get("location"):
            location = detail["location"]
        company = canonical_company(company)
        applicant_text = detail.get("applicant_text", "")
        if not is_relevant_title(title):
            drop("title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_relevant_location(location, desc_text):
            drop("location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_linkedin_company(company):
            drop("company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(
            {
                "posted_text": detail.get("posted_text", "") or job.get("posted_text", ""),
                "posted_date": detail.get("posted_date", "") or job.get("posted_date", ""),
            }
        )
        if not is_linkedin_within_window(posted_display, posted_raw, posted_date, company):
            drop(
                "window",
                {
                    "company": company,
                    "title": title,
                    "location": location,
                    "posted": posted_display,
                    "posted_raw": posted_raw,
                    "posted_date": posted_date,
                    "link": job.get("link", ""),
                },
            )
            continue

        summary = desc_text[:2500]
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "Aggregator", "LinkedIn")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "Aggregator", "LinkedIn")
        if is_target_firm(company) or is_linkedin_included_company(company):
            min_score = min(min_score, 65)
        keep_threshold = min(min_score, keep_score_threshold("Aggregator", "LinkedIn"))
        if score < keep_threshold:
            drop(
                "score",
                {
                    "company": company,
                    "title": title,
                    "location": location,
                    "score": score,
                    "min_score": min_score,
                    "link": job.get("link", ""),
                },
            )
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="LinkedIn",
                source_family="Aggregator",
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                applicant_count=applicant_text,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    if detail_jobs_processed:
        add_source_note(diag, f"linkedin detail jobs processed={detail_jobs_processed}")
    return records


def collect_greenhouse_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    greenhouse_jobs = greenhouse_search(session)
    print(f"[Greenhouse] {len(greenhouse_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("Greenhouse", len(greenhouse_jobs))
    for job in greenhouse_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, "", company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "Greenhouse"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not is_direct_ats_within_window(posted_display, posted_raw, posted_date, company):
            diag["dropped"]["window"] += 1
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "Greenhouse")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "Greenhouse")
        if score < keep_score_threshold("ATS", "Greenhouse"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="Greenhouse",
                source_family="ATS",
                ats_family="Greenhouse",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_lever_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    lever_jobs = lever_search(session)
    print(f"[Lever] {len(lever_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("Lever", len(lever_jobs))
    for job in lever_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, "", company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "Lever"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not is_direct_ats_within_window(posted_display, posted_raw, posted_date, company):
            diag["dropped"]["window"] += 1
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "Lever")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "Lever")
        if score < keep_score_threshold("ATS", "Lever"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="Lever",
                source_family="ATS",
                ats_family="Lever",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_smartrecruiters_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    smart_jobs = smartrecruiters_search(session)
    print(f"[SmartRecruiters] {len(smart_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("SmartRecruiters", len(smart_jobs))
    for job in smart_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, "", company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "SmartRecruiters"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not is_direct_ats_within_window(posted_display, posted_raw, posted_date, company):
            diag["dropped"]["window"] += 1
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "SmartRecruiters")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "SmartRecruiters")
        if score < keep_score_threshold("ATS", "SmartRecruiters"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="SmartRecruiters",
                source_family="ATS",
                ats_family="SmartRecruiters",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_ashby_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    ashby_jobs = ashby_search(session)
    print(f"[Ashby] {len(ashby_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("Ashby", len(ashby_jobs))
    for job in ashby_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "") or "Remote"
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, "", company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "Ashby"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not is_direct_ats_within_window(posted_display, posted_raw, posted_date, company):
            diag["dropped"]["window"] += 1
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "Ashby")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "Ashby")
        if score < keep_score_threshold("ATS", "Ashby"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="Ashby",
                source_family="ATS",
                ats_family="Ashby",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_workable_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    workable_jobs = workable_search(session)
    print(f"[Workable] {len(workable_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("Workable", len(workable_jobs))
    for job in workable_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "") or "Remote"
        summary = job.get("summary", "")
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, summary, company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "Workable"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            diag["dropped"]["window"] += 1
            continue

        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "Workable")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "Workable")
        if score < keep_score_threshold("ATS", "Workable"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="Workable",
                source_family="ATS",
                ats_family="Workable",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                job_status=job.get("job_status", ""),
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_workday_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    workday_jobs = workday_search(session)
    print(f"[Workday] {len(workday_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("Workday", len(workday_jobs))
    for job in workday_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        summary = job.get("summary", "")
        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            continue
        if not is_direct_ats_relevant_location(location, summary, company):
            diag["dropped"]["location"] += 1
            continue
        if not should_keep_role_company(company, "ATS", "Workday"):
            diag["dropped"]["company"] += 1
            continue
        if not is_direct_ats_within_window(posted_display, posted_raw, posted_date, company):
            diag["dropped"]["window"] += 1
            continue
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "Workday")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "Workday")
        if score < keep_score_threshold("ATS", "Workday"):
            diag["dropped"]["score"] += 1
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="Workday",
                source_family="ATS",
                ats_family="Workday",
                ats_account=job.get("ats_account", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                job_status=job.get("job_status", ""),
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_job_board_source(session: requests.Session, source: dict) -> list[dict]:
    jobs: list[dict] = []
    if source["type"] == "rss":
        jobs.extend(rss_search(session, source["url"], source["name"]))
    elif source["type"] == "api":
        if source["name"] == "Remotive":
            jobs.extend(remotive_search(session))
        elif source["name"] == "RemoteOK":
            jobs.extend(remoteok_search(session))
        elif source["name"] == "Jobicy":
            jobs.extend(jobicy_search(session))
        elif source["name"] == "MeetFrank":
            jobs.extend(meetfrank_search(session))
        elif source["name"] == "Adzuna":
            jobs.extend(adzuna_search(session))
        elif source["name"] == "Jooble":
            jobs.extend(jooble_search(session))
        elif source["name"] == "Reed":
            jobs.extend(reed_search(session))
        elif source["name"] == "CVLibrary":
            jobs.extend(cvlibrary_search(session))
        elif source["name"] == "Workday":
            jobs.extend(workday_search(session))
    elif source["type"] == "html":
        if source["name"] == "JobServe":
            jobs.extend(jobserve_search(session))
        elif source["name"] == "WeLoveProduct":
            jobs.extend(weloveproduct_search(session))
        elif source["name"] == "Totaljobs":
            jobs.extend(html_board_search(session, "Totaljobs", source["url"]))
        elif source["name"] == "CWJobs":
            jobs.extend(html_board_search(session, "CWJobs", source["url"]))
        elif source["name"] == "Jobsite":
            jobs.extend(html_board_search(session, "Jobsite", source["url"]))
        elif source["name"] == "Technojobs":
            jobs.extend(technojobs_search(session))
        elif source["name"] == "BuiltInLondon":
            jobs.extend(builtin_london_search(session))
        elif source["name"] == "eFinancialCareers":
            jobs.extend(efinancialcareers_search(session))
        elif source["name"] == "IndeedUK":
            jobs.extend(indeed_search(session))
        elif source["name"] == "CustomCareers":
            jobs.extend(custom_careers_search(session))
        elif source["name"] == "WorkInStartups":
            jobs.extend(workinstartups_search(session))
    return jobs


def collect_custom_careers_records(session: requests.Session) -> list[JobRecord]:
    """Scrape the 196 bespoke careers pages (uk_firm_feeds.csv platform=Custom)
    in parallel via JSON-LD or generic href patterns."""
    records: list[JobRecord] = []
    raw_jobs = direct_custom_careers_search(session)
    diag = init_source_diagnostic("DirectCareers", len(raw_jobs))
    for job in raw_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "") or "Remote"
        if not is_relevant_title_direct(title):
            diag["dropped"]["title"] += 1
            add_source_diagnostic_example(diag, "title", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not is_direct_ats_relevant_location(location, job.get("summary", ""), company):
            diag["dropped"]["location"] += 1
            add_source_diagnostic_example(diag, "location", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue
        if not should_keep_role_company(company, "ATS", "DirectCareers"):
            diag["dropped"]["company"] += 1
            add_source_diagnostic_example(diag, "company", {"company": company, "title": title, "location": location, "link": job.get("link", "")})
            continue

        # Posted date is often missing in custom careers JSON-LD; treat as fresh.
        posted_raw = job.get("posted_date", "")
        posted_display = posted_raw or "Recent"
        posted_date = posted_raw

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "ATS", "DirectCareers")
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "ATS", "DirectCareers")
        if score < keep_score_threshold("ATS", "DirectCareers"):
            diag["dropped"]["score"] += 1
            add_source_diagnostic_example(diag, "score", {"company": company, "title": title, "score": score, "link": job.get("link", "")})
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source="DirectCareers",
                source_family="ATS",
                ats_family="DirectCareers",
                ats_account=job.get("source_firm", ""),
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
        add_source_diagnostic_example(
            diag,
            "kept",
            {"company": company, "title": title, "location": location, "score": score, "link": job.get("link", "")},
        )
    return records


def collect_job_board_records(session: requests.Session, source: dict) -> list[JobRecord]:
    records: list[JobRecord] = []
    source_name = source["name"]
    board_jobs = collect_job_board_source(session, source)
    print(f"[Job boards:{source_name}] {len(board_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic(source_name, len(board_jobs))
    for job in board_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        raw_location = (job.get("location", "") or "").strip()
        location = raw_location or "Remote"
        summary = job.get("summary", "")
        effective_source_name = job.get("source", "Job board")
        target_stats = None
        if effective_source_name == "CustomCareers":
            target_stats = _init_custom_target_diagnostic(job, company)
            if target_stats:
                target_stats["raw"] += 1

        title_ok = (
            is_custom_careers_relevant_title(title, company, summary)
            if effective_source_name == "CustomCareers"
            else is_relevant_title(title)
        )
        if not title_ok:
            if diag:
                diag["dropped"]["title"] += 1
                add_source_diagnostic_example(
                    diag,
                    "title",
                    {"company": company, "title": title, "location": location, "summary": summary[:200]},
                )
            if target_stats:
                target_stats["dropped"]["title"] += 1
            continue

        location_ok = (
            is_custom_careers_relevant_location(raw_location, summary, company)
            if effective_source_name == "CustomCareers"
            else is_relevant_location(location, summary)
        )
        if not location_ok:
            if diag:
                diag["dropped"]["location"] += 1
                add_source_diagnostic_example(
                    diag,
                    "location",
                    {"company": company, "title": title, "location": raw_location, "summary": summary[:200]},
                )
            if target_stats:
                target_stats["dropped"]["location"] += 1
            continue

        company_ok = should_keep_role_company(company, "JobBoard", effective_source_name)
        if effective_source_name == "CustomCareers" and is_target_firm(company):
            company_ok = True
        if not company_ok:
            if diag:
                diag["dropped"]["company"] += 1
                add_source_diagnostic_example(
                    diag,
                    "company",
                    {"company": company, "title": title, "location": location, "raw_company": job.get("company", "")},
                )
            if target_stats:
                target_stats["dropped"]["company"] += 1
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        within_window = parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS)
        if effective_source_name == "CustomCareers" and not posted_raw and not posted_date:
            within_window = True
        if not within_window:
            if diag:
                diag["dropped"]["window"] += 1
                add_source_diagnostic_example(
                    diag,
                    "window",
                    {
                        "company": company,
                        "title": title,
                        "location": location,
                        "posted_display": posted_display,
                        "posted_raw": posted_raw,
                        "posted_date": posted_date,
                    },
                )
            if target_stats:
                target_stats["dropped"]["window"] += 1
            continue

        full_text = f"{title} {company} {summary}"
        fit = assess_fit(full_text, company, "JobBoard", effective_source_name)
        score = int(fit["score"])
        min_score = min_score_for_fit(fit, "JobBoard", effective_source_name)
        if score < min(min_score, keep_score_threshold("JobBoard", effective_source_name)):
            if diag:
                diag["dropped"]["score"] += 1
                add_source_diagnostic_example(
                    diag,
                    "score",
                    {
                        "company": company,
                        "title": title,
                        "location": location,
                        "score": score,
                        "min_score": min_score,
                        "summary": summary[:200],
                    },
                )
            if target_stats:
                target_stats["dropped"]["score"] += 1
            continue

        records.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_display,
                posted_raw=posted_raw,
                posted_date=posted_date,
                source=effective_source_name,
                source_family="JobBoard",
                email_bucket="main" if score >= min_score else "borderline",
                fit_score=score,
                fit_verdict=str(fit["fit_verdict"]),
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                salary_min=job.get("salary_min", 0),
                salary_max=job.get("salary_max", 0),
            )
        )
        if diag:
            diag["kept"] += 1
            add_source_diagnostic_example(
                diag,
                "kept",
                {
                    "company": company,
                    "title": title,
                    "location": location,
                    "score": score,
                    "posted_display": posted_display,
                    "posted_raw": posted_raw,
                    "posted_date": posted_date,
                    "link": job.get("link", ""),
                },
            )
        if target_stats:
            target_stats["kept"] += 1
    if diag:
        if source_name == "IndeedUK":
            runtime = get_source_runtime_events().get("IndeedUK", {})
            log_trace(
                "[diag] "
                f"{source_name} raw_fetched={diag['raw']} "
                f"blocked_pages={int(runtime.get('blocked', 0) or 0)} "
                f"page_count_attempted={int(runtime.get('page_count', 0) or 0)} "
                f"attempted_queries={int(runtime.get('query_count', 0) or 0)} "
                f"kept={diag['kept']}"
            )
        log_trace(
            "[diag] "
            f"{source_name} raw={diag['raw']} kept={diag['kept']} "
            f"dropped_title={diag['dropped']['title']} "
            f"dropped_location={diag['dropped']['location']} "
            f"dropped_company={diag['dropped']['company']} "
            f"dropped_window={diag['dropped']['window']} "
            f"dropped_score={diag['dropped']['score']}"
        )
    return records

try:
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001
    ZoneInfo = None


def run_hot_scan() -> int:
    """Fast detection (Part F): ATS-only scan that Telegram-alerts fresh,
    high-fit, supported-ATS roles not previously alerted.

    No LLM, no LinkedIn, no job boards, no digest email — each run finishes in
    seconds. Safe to call on a tight cron or from an always-on poller (Tier 2:
    `while True: run_hot_scan(); sleep(90)`). Returns the number of new alerts.
    """
    if not config.HOT_SCAN_ENABLED:
        print("hot-scan disabled (JOB_DIGEST_HOT_SCAN_ENABLED=false)")
        return 0

    from .notify_telegram import is_configured, send_alert

    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})
    reset_source_diagnostics()
    reset_source_runtime_events()

    records: list[JobRecord] = []
    records.extend(run_source_stage("greenhouse", lambda: collect_greenhouse_records(session)))
    records.extend(run_source_stage("lever", lambda: collect_lever_records(session)))
    records.extend(run_source_stage("ashby", lambda: collect_ashby_records(session)))
    records.extend(run_source_stage("workable", lambda: collect_workable_records(session)))

    records = dedupe_records(records)
    for record in records:
        compute_priority_score(record)

    candidates = select_hot_lane(records, min_fit=config.HOT_SCAN_MIN_FIT, limit=None)
    print(f"hot-scan: {len(records)} ATS records, {len(candidates)} fresh high-fit candidates")
    if not candidates:
        return 0

    # Upsert so the portal's #apply-now deep link resolves to a real doc.
    try:
        write_records_to_firestore(candidates)
    except Exception as exc:  # noqa: BLE001
        print(f"hot-scan firestore upsert failed: {type(exc).__name__}: {exc}")

    client = init_firestore_client()
    # File cache keeps local runs (no Firestore) non-spammy; the durable guard
    # in CI is the Firestore `hot_alerted_at` flag (the file doesn't persist there).
    file_cache = prune_seen_cache(load_seen_cache(config.HOT_ALERTED_CACHE_PATH), config.SEEN_CACHE_DAYS)
    now_iso = now_utc().isoformat()
    alerts = 0

    for rec in filter_new_records(candidates, file_cache):
        doc_id = record_document_id(rec)
        already_alerted = False
        if client is not None:
            try:
                snap = client.collection(config.FIREBASE_COLLECTION).document(doc_id).get()
                already_alerted = snap.exists and bool((snap.to_dict() or {}).get("hot_alerted_at"))
            except Exception:
                already_alerted = False
        if already_alerted:
            if rec.link:
                file_cache[rec.link] = now_iso
            continue

        if not is_configured():
            print(f"hot-scan: would alert {rec.company} / {rec.role} (fit {rec.fit_score}) — Telegram not configured")
        elif send_alert(rec):
            alerts += 1
            print(f"hot-scan alert sent: {rec.company} / {rec.role} (fit {rec.fit_score})")

        if rec.link:
            file_cache[rec.link] = now_iso
        if client is not None:
            try:
                client.collection(config.FIREBASE_COLLECTION).document(doc_id).set(
                    {"hot_alerted_at": now_iso}, merge=True
                )
            except Exception:
                pass

    save_seen_cache(config.HOT_ALERTED_CACHE_PATH, file_cache)
    print(f"hot-scan: {alerts} new alert(s) sent")
    return alerts


def main(
    *,
    skip_enrichment: bool = False,
    skip_post_hooks: bool = False,
    scrape_only: bool = False,
    ignore_seen_cache: bool = False,
    validation_digest: bool = False,
    skip_linkedin: bool = False,
    fast_email: bool = False,
    run_slot_key: str = "",
) -> None:
    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})
    reset_source_diagnostics()
    reset_source_runtime_events()

    all_jobs: list[JobRecord] = []
    firestore_client = init_firestore_client()

    manual_requests = fetch_manual_link_requests(firestore_client)
    if manual_requests:
        for req in manual_requests:
            link = req.get("link") or ""
            req_id = req.get("id") or ""
            record = build_manual_record(session, link) if link else None
            if record:
                all_jobs.append(record)
                if firestore_client and req_id:
                    try:
                        firestore_client.collection(config.RUN_REQUESTS_COLLECTION).document(req_id).set(
                            {
                                "status": "processed",
                                "processed_at": datetime.now(timezone.utc).isoformat(),
                                "job_id": record_document_id(record),
                            },
                            merge=True,
                        )
                    except Exception:
                        pass
            else:
                if firestore_client and req_id:
                    try:
                        firestore_client.collection(config.RUN_REQUESTS_COLLECTION).document(req_id).set(
                            {
                                "status": "failed",
                                "processed_at": datetime.now(timezone.utc).isoformat(),
                            },
                            merge=True,
                        )
                    except Exception:
                        pass

    if not skip_linkedin:
        all_jobs.extend(run_source_stage("linkedin", lambda: collect_linkedin_records(session)))
    else:
        diag = init_source_diagnostic("LinkedIn", 0)
        add_source_note(diag, "skipped by CLI flag")
    all_jobs.extend(run_source_stage("greenhouse", lambda: collect_greenhouse_records(session)))
    all_jobs.extend(run_source_stage("lever", lambda: collect_lever_records(session)))
    all_jobs.extend(run_source_stage("smartrecruiters", lambda: collect_smartrecruiters_records(session)))
    all_jobs.extend(run_source_stage("ashby", lambda: collect_ashby_records(session)))
    all_jobs.extend(run_source_stage("workable", lambda: collect_workable_records(session)))
    all_jobs.extend(run_source_stage("workday", lambda: collect_workday_records(session)))
    all_jobs.extend(run_source_stage("custom_careers", lambda: collect_custom_careers_records(session)))
    for source in JOB_BOARD_SOURCES:
        if source["name"] == "Workday":
            continue
        if fast_email and source["name"] not in config.FAST_EMAIL_JOB_BOARD_SOURCES:
            diag = init_source_diagnostic(source["name"], 0)
            add_source_note(diag, "skipped by --fast-email")
            continue
        all_jobs.extend(
            run_source_stage(
                f"job_board:{source['name']}",
                lambda source=source: collect_job_board_records(session, source),
            )
        )

    records = run_step("dedupe_records", lambda: dedupe_records(sorted(all_jobs, key=lambda x: x.fit_score, reverse=True)))
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    pre_seen_records = list(records)
    seen_cache: dict[str, str] = {}
    if not ignore_seen_cache:
        seen_cache = prune_seen_cache(load_seen_cache(config.SEEN_CACHE_PATH), config.SEEN_CACHE_DAYS)
        records = filter_new_records(records, seen_cache)
        records = sorted(records, key=lambda record: record.fit_score, reverse=True)
    update_seen_cache_summary(pre_seen_records, records)

    if not skip_enrichment:
        records = run_step("enhance_records_with_groq", lambda: enhance_records_with_groq(records))
        records = [record for record in records if int(record.fit_score or 0) >= config.EMAIL_BORDERLINE_MIN_SCORE]
        records = sorted(records, key=lambda record: record.fit_score, reverse=True)
    records = ensure_record_richness(records)
    # Freshness + scarcity ranking (Part A): stamp priority_score and re-order so
    # fresh, low-applicant high-fit roles float up. Bucket split below stays on
    # raw fit_score, so "Maybe" classification is unchanged — only order shifts.
    for record in records:
        compute_priority_score(record)
    records = sorted(records, key=lambda record: record.priority_score, reverse=True)
    main_records = [record for record in records if int(record.fit_score or 0) > config.EMAIL_BORDERLINE_MAX_SCORE]
    borderline_candidates = [
        record
        for record in records
        if config.EMAIL_BORDERLINE_MIN_SCORE <= int(record.fit_score or 0) <= config.EMAIL_BORDERLINE_MAX_SCORE
    ]
    borderline_records = borderline_candidates[: config.MAX_BORDERLINE_EMAIL_ROLES]
    if config.MIN_LINKEDIN_BORDERLINE_ROLES > 0:
        selected_links = {record.link for record in borderline_records if record.link}
        selected_linkedin_count = sum(1 for record in borderline_records if record.source == "LinkedIn")
        needed_linkedin_count = max(0, config.MIN_LINKEDIN_BORDERLINE_ROLES - selected_linkedin_count)
        linkedin_candidates = [
            record
            for record in borderline_candidates
            if record.source == "LinkedIn" and record.link not in selected_links
        ][:needed_linkedin_count]
        for linkedin_record in linkedin_candidates:
            if len(borderline_records) < config.MAX_BORDERLINE_EMAIL_ROLES:
                borderline_records.append(linkedin_record)
                continue
            for index in range(len(borderline_records) - 1, -1, -1):
                if borderline_records[index].source != "LinkedIn":
                    borderline_records[index] = linkedin_record
                    break
        borderline_records = sorted(borderline_records, key=lambda record: record.fit_score, reverse=True)
    for record in main_records:
        record.email_bucket = "main"
    for record in borderline_records:
        record.email_bucket = "borderline"

    if ignore_seen_cache or not config.ALLOW_SEEN_TOP_UP:
        delivery_records = main_records
    else:
        delivery_records = build_delivery_records(main_records, pre_seen_records)
    delivery_records = ensure_record_richness(delivery_records)
    email_records = delivery_records + borderline_records
    RUN_SUMMARY["delivery_roles"] = len(delivery_records)
    RUN_SUMMARY["new_roles"] = len(records)
    RUN_SUMMARY["delivery_top_up_roles"] = max(0, len(delivery_records) - len(main_records))
    RUN_SUMMARY["borderline_roles"] = len(borderline_records)

    digest_suffix = "_scrape_only" if scrape_only else ""
    if validation_digest:
        digest_suffix = "_validation"
    elif ignore_seen_cache:
        digest_suffix += "_ignore_seen"
    if not digest_suffix and config.WRITE_SLOT_DIGESTS:
        if run_slot_key and run_slot_key not in {"manual", "unscheduled"}:
            digest_suffix = "_" + run_slot_key.rsplit("-", 1)[-1].replace(":", "")
        else:
            digest_suffix = "_" + datetime.now().strftime("%H%M%S")
    out_xlsx, out_csv = run_step(
        "write_digest_outputs",
        lambda: write_digest_outputs(email_records, suffix=digest_suffix),
    )
    RUN_SUMMARY["completed"] = True
    RUN_SUMMARY["validation_digest_written"] = bool(validation_digest or ignore_seen_cache)
    RUN_SUMMARY["validation_digest_path"] = str(out_csv) if (validation_digest or ignore_seen_cache) else ""
    RUN_SUMMARY["stage_timeout_hit"] = any(int(diag.get("timed_out", 0) or 0) > 0 for diag in SOURCE_DIAGNOSTICS.values())
    save_custom_careers_health_state(finalize_custom_target_diagnostics())
    diagnostics_path = write_source_diagnostics(suffix=digest_suffix)

    if not scrape_only:
        run_step("write_records_to_firestore", lambda: write_records_to_firestore(email_records))
        run_step("write_notifications", lambda: write_notifications(main_records))
        run_step("write_source_stats", lambda: write_source_stats(email_records))

    if not scrape_only and not skip_post_hooks:
        run_step("write_role_suggestions", write_role_suggestions)
        run_step("write_candidate_prep", write_candidate_prep)
        run_step("cleanup_stale_jobs", cleanup_stale_jobs)

    if scrape_only:
        print(f"Digest generated: {out_xlsx}")
        print(f"Roles found: {len(email_records)}")
        if borderline_records:
            print(f"Borderline roles included: {len(borderline_records)}")
        if len(delivery_records) != len(main_records):
            print(f"New main roles found: {len(main_records)}")
            print(f"Qualified top-up roles: {len(delivery_records) - len(main_records)}")
        if not records and int(RUN_SUMMARY.get("pre_seen_kept", 0) or 0) > 0 and not (validation_digest or ignore_seen_cache):
            print("Production digest empty because all kept roles were already seen.")
        print_source_yield(email_records)
        print_source_health_summary()
        print_seen_cache_summary(validation_digest_path=str(out_csv) if (validation_digest or ignore_seen_cache) else "")
        print_recent_digest_forecast()
        if diagnostics_path is not None:
            print(f"Source diagnostics: {diagnostics_path}")
        return

    top_pick = select_top_pick(delivery_records)
    top_records = delivery_records[: max(config.MAX_EMAIL_ROLES, config.MIN_EMAIL_ROLES)]
    if top_pick and top_pick not in top_records:
        top_records = [top_pick] + top_records
        top_records = top_records[: max(config.MAX_EMAIL_ROLES, config.MIN_EMAIL_ROLES)]
    hot_lane = select_hot_lane(top_records + borderline_records)
    html_body = build_email_html(top_records + borderline_records, config.WINDOW_HOURS, hot_lane=hot_lane)
    delivery_summary_html = (
        "<div style='background:#ECFDF5; border:1px solid #BBF7D0; padding:10px; "
        "border-radius:8px; margin-bottom:14px; font-size:14px; color:#064E3B;'>"
        f"<strong>New roles:</strong> {len(records)} &nbsp; "
        f"<strong>Qualified roles shown:</strong> {len(top_records)}"
        + (f" &nbsp; <strong>Borderline shown:</strong> {len(borderline_records)}" if borderline_records else "")
        + "</div>"
    )
    from .daily_focus import build_focus_html, build_focus_text
    focus_html = build_focus_html()
    if "<h2" in html_body:
        html_body = html_body.replace("</h2>", "</h2>" + delivery_summary_html, 1)
    if focus_html and "<h2" in html_body:
        html_body = html_body.replace("</h2>", "</h2>" + focus_html, 1)
    def compact_text(value: str, limit: int = 180) -> str:
        text = " ".join((value or "").split())
        if len(text) <= limit:
            return text
        return text[: limit - 1].rstrip() + "..."

    text_lines = [
        f"Daily job digest (last {config.WINDOW_HOURS} hours).",
        f"Preferences: {config.PREFERENCES}",
        f"Sources checked: {build_sources_summary(compact=True)}",
        f"New roles found: {len(records)}",
        f"Qualified roles shown: {len(top_records)}",
        f"Borderline roles shown: {len(borderline_records)}",
        "",
        build_focus_text(),
        "",
    ]
    if top_pick:
        text_lines.append("Top pick:")
        text_lines.append(
            f"- {top_pick.role} | {top_pick.company} | {top_pick.posted} | "
            f"Source {top_pick.source} | Fit {top_pick.fit_score}%"
        )
        text_lines.append(f"  Preference match: {top_pick.preference_match}")
        text_lines.append(f"  Why: {compact_text(top_pick.why_fit)}")
        text_lines.append(f"  Action/watch: {compact_text(top_pick.apply_tips or top_pick.cv_gap or top_pick.tailored_summary)}")
        if top_pick.fit_verdict:
            text_lines.append(f"  Verdict: {top_pick.fit_verdict}")
        text_lines.append(f"  Link: {top_pick.link}")
        text_lines.append("")
    top_pick_link = top_pick.link if top_pick else None
    for rec in top_records + borderline_records:
        if top_pick_link and rec.link == top_pick_link:
            continue
        text_lines.append(
            f"- {rec.role} | {rec.company} | {rec.posted} | "
            f"Source {rec.source} | Fit {rec.fit_score}%"
        )
        text_lines.append(f"  Preference match: {rec.preference_match}")
        text_lines.append(f"  Why: {compact_text(rec.why_fit)}")
        text_lines.append(f"  Action/watch: {compact_text(rec.apply_tips or rec.cv_gap or rec.tailored_summary)}")
        if rec.fit_verdict:
            text_lines.append(f"  Verdict: {rec.fit_verdict}")
        text_lines.append(f"  Link: {rec.link}")
        text_lines.append("")
    text_body = "\n".join(text_lines)

    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"Daily Job Digest - {today}"
    if not top_records and not borderline_records:
        print(
            "Skipping email: no qualified or borderline roles to report this run "
            f"(pre_seen_kept={RUN_SUMMARY.get('pre_seen_kept', 0)}, "
            f"seen_filtered={RUN_SUMMARY.get('seen_filtered', 0)})."
        )
        email_sent = False
    else:
        email_sent = send_email(subject, html_body, text_body)

    for record in email_records:
        if record.link:
            seen_cache[record.link] = now_utc().isoformat()
            canonical_link = canonical_job_link(record.link)
            if canonical_link:
                seen_cache[canonical_link] = now_utc().isoformat()
        for alt in record.alternate_links:
            link = alt.get("link") if isinstance(alt, dict) else ""
            if link:
                seen_cache[link] = now_utc().isoformat()
                canonical_link = canonical_job_link(link)
                if canonical_link:
                    seen_cache[canonical_link] = now_utc().isoformat()
    save_seen_cache(config.SEEN_CACHE_PATH, seen_cache)
    if run_slot_key and run_slot_key not in {"manual", "unscheduled"} and not (scrape_only or validation_digest):
        state = load_run_state(config.RUN_STATE_PATH)
        last_slots = state.get("last_run_slots", [])
        if not isinstance(last_slots, list):
            last_slots = []
        if run_slot_key not in last_slots:
            last_slots.append(run_slot_key)
        state["last_run_slots"] = last_slots[-50:]
        save_run_state(config.RUN_STATE_PATH, state)

    print(f"Digest generated: {out_xlsx}")
    print(f"Roles found: {len(email_records)}")
    if borderline_records:
        print(f"Borderline roles included: {len(borderline_records)}")
    if len(delivery_records) != len(main_records):
        print(f"New main roles found: {len(main_records)}")
        print(f"Qualified top-up roles: {len(delivery_records) - len(main_records)}")
    print_source_yield(email_records)
    print_source_health_summary()
    print_recent_digest_forecast()


def cli() -> None:
    parser = argparse.ArgumentParser(description="Daily job digest runner")
    parser.add_argument("--smoke-test", action="store_true", help="Run a source connectivity smoke test")
    parser.add_argument("--force", action="store_true", help="Force a run outside schedule")
    parser.add_argument(
        "--backfill-role-summary",
        action="store_true",
        help="Regenerate role summaries for existing Firestore jobs",
    )
    parser.add_argument(
        "--backfill-limit",
        type=int,
        default=0,
        help="Limit number of jobs to backfill (0 = all)",
    )
    parser.add_argument(
        "--backfill-diagnose",
        action="store_true",
        help="Run diagnostics for backfill connectivity and model access",
    )
    parser.add_argument(
        "--backfill-posted-dates",
        action="store_true",
        help="Normalize posted fields for existing Firestore jobs",
    )
    parser.add_argument(
        "--skip-enrichment",
        action="store_true",
        help="Skip LLM enhancement and write the digest after scrape/dedupe only",
    )
    parser.add_argument(
        "--skip-post-hooks",
        action="store_true",
        help="Skip role suggestions, candidate prep, and stale cleanup",
    )
    parser.add_argument(
        "--scrape-only",
        action="store_true",
        help="Only scrape/filter/dedupe and write digest outputs; skip Firestore writes and post-hooks",
    )
    parser.add_argument(
        "--ignore-seen-cache",
        action="store_true",
        help="Validation mode: bypass seen-cache filtering so kept roles are written even if already seen",
    )
    parser.add_argument(
        "--validation-digest",
        action="store_true",
        help="Write a validation digest showing kept roles before seen-cache suppression",
    )
    parser.add_argument(
        "--skip-linkedin",
        action="store_true",
        help="Skip LinkedIn for source-isolation and validation runs",
    )
    parser.add_argument(
        "--fast-email",
        action="store_true",
        help="Skip slow optional job boards for scheduled email delivery",
    )
    parser.add_argument(
        "--hot-scan",
        action="store_true",
        help="Fast detection: scan ATS feeds only and Telegram-alert fresh high-fit roles (no LLM/email)",
    )
    args = parser.parse_args()

    if args.hot_scan:
        run_hot_scan()
    elif args.smoke_test:
        run_smoke_test()
    elif args.backfill_diagnose:
        diagnose_backfill()
    elif args.backfill_posted_dates:
        backfill_posted_dates(limit=args.backfill_limit or None)
    elif args.backfill_role_summary:
        backfill_role_summaries(limit=args.backfill_limit or None)
    else:
        run_slot_key = due_run_slot(force=args.force)
        if not run_slot_key:
            print("Skipping run: outside scheduled run window or already sent for this slot.")
            raise SystemExit(0)
        main(
            skip_enrichment=args.skip_enrichment or args.fast_email or args.scrape_only or args.validation_digest,
            skip_post_hooks=args.skip_post_hooks or args.scrape_only or args.validation_digest,
            scrape_only=args.scrape_only or args.validation_digest,
            ignore_seen_cache=args.ignore_seen_cache or args.validation_digest,
            validation_digest=args.validation_digest,
            skip_linkedin=args.skip_linkedin,
            fast_email=args.fast_email,
            run_slot_key="" if args.force else run_slot_key,
        )


if __name__ == "__main__":
    cli()
