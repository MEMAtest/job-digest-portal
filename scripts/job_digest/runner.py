from __future__ import annotations

import argparse
import csv
import json
import os
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
    build_gaps,
    build_preference_match,
    build_reasons,
    is_relevant_location,
    is_relevant_title,
    score_fit,
)
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
    filter_new_records,
    is_target_firm,
    load_run_state,
    load_seen_cache,
    now_utc,
    parse_posted_within_window,
    prune_seen_cache,
    save_run_state,
    save_seen_cache,
    select_top_pick,
    should_keep_role_company,
    should_run_now,
    _parse_run_time,
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
SOURCE_HEALTH_WEAK_YIELD_MIN_RAW = int(os.getenv("JOB_DIGEST_WEAK_YIELD_MIN_RAW", "10") or "10")
SOURCE_HEALTH_WEAK_YIELD_RATIO = float(os.getenv("JOB_DIGEST_WEAK_YIELD_RATIO", "0.15") or "0.15")
RECENT_DIGEST_SAMPLE_SIZE = int(os.getenv("JOB_DIGEST_FORECAST_SAMPLE_SIZE", "10") or "10")
SOURCE_DIAGNOSTICS: dict[str, dict] = {}
CUSTOM_CAREERS_TARGET_DIAGNOSTICS: dict[str, dict] = {}

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
    return source_name in {"CustomCareers", "IndeedUK"}


def reset_source_diagnostics() -> None:
    SOURCE_DIAGNOSTICS.clear()
    CUSTOM_CAREERS_TARGET_DIAGNOSTICS.clear()


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
            "mode": "",
            "query_count": 0,
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
    if len(examples) < SOURCE_DIAGNOSTICS_LIMIT:
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
        if diag.get("mode"):
            parts.append(f"mode={diag['mode']}")
        if diag.get("query_count"):
            parts.append(f"queries={diag['query_count']}")
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


def write_source_diagnostics(suffix: str = "") -> Path | None:
    merge_runtime_source_events()
    if not SOURCE_DIAGNOSTICS:
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_path = config.DIGEST_DIR / f"source_diagnostics_{today}{suffix}.json"
    try:
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(SOURCE_DIAGNOSTICS, handle, indent=2, ensure_ascii=False)
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
            "Fit_Score_%": r.fit_score,
            "Fit_Verdict": r.fit_verdict,
            "Preference_Match": r.preference_match,
            "Why_Fit": r.why_fit,
            "CV_Gap": r.cv_gap,
            "Role_Summary": r.role_summary,
            "Tailored_Summary": r.tailored_summary,
            "Tailored_CV_Bullets": " | ".join(r.tailored_cv_bullets),
            "Key_Requirements": " | ".join(r.key_requirements),
            "Match_Notes": r.match_notes,
            "Company_Insights": r.company_insights,
            "Cover_Letter": r.cover_letter,
            "Key_Talking_Points": " | ".join(r.key_talking_points),
            "STAR_Stories": " | ".join(r.star_stories),
            "Quick_Pitch": r.quick_pitch,
            "Interview_Focus": r.interview_focus,
            "Prep_Questions": " | ".join(r.prep_questions),
            "Prep_Answers": " | ".join(r.prep_answers),
            "Scorecard": " | ".join(r.scorecard),
            "Apply_Tips": r.apply_tips,
            "Notes": r.notes,
        }
        for r in records
    ])

    df.to_excel(out_xlsx, index=False)
    df.to_csv(out_csv, index=False)
    return out_xlsx, out_csv


def print_source_yield(records: list[JobRecord]) -> None:
    source_counts: dict[str, int] = {}
    for record in records:
        src = record.source or "Unknown"
        source_counts[src] = source_counts.get(src, 0) + 1
    print("\n--- Source Yield in Digest ---")
    if source_counts:
        for src, cnt in sorted(source_counts.items(), key=lambda item: -item[1]):
            print(f"  {src}: {cnt}")
    else:
        print("  (no roles in digest this run)")
    print("--- End Source Summary ---")


def collect_linkedin_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    linkedin_jobs = linkedin_search(session)
    print(f"[LinkedIn] {len(linkedin_jobs)} raw results fetched (before filtering)")
    diag = init_source_diagnostic("LinkedIn", len(linkedin_jobs))
    for job in linkedin_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "")
        if not is_relevant_title(title):
            continue

        detail = linkedin_job_details(session, job["job_id"])
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
            continue
        if not is_relevant_location(location, desc_text):
            continue
        if not should_keep_role_company(company, "Aggregator", "LinkedIn"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(
            {
                "posted_text": detail.get("posted_text", "") or job.get("posted_text", ""),
                "posted_date": detail.get("posted_date", "") or job.get("posted_date", ""),
            }
        )
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            continue

        summary = desc_text[:2500]
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                applicant_count=applicant_text,
            )
        )
        diag["kept"] += 1
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
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue
        if not should_keep_role_company(company, "ATS", "Greenhouse"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
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
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue
        if not should_keep_role_company(company, "ATS", "Lever"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
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
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue
        if not should_keep_role_company(company, "ATS", "SmartRecruiters"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
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
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue
        if not should_keep_role_company(company, "ATS", "Ashby"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, 30 * 24):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
            )
        )
        diag["kept"] += 1
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
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue
        if not should_keep_role_company(company, "ATS", "Workable"):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, 30 * 24):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
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
                fit_score=score,
                preference_match=build_preference_match(full_text, company, location),
                why_fit=build_reasons(full_text),
                cv_gap=build_gaps(full_text),
                notes=summary,
                job_status=job.get("job_status", ""),
            )
        )
        diag["kept"] += 1
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
        score, _, _ = score_fit(full_text, company)
        min_score = config.MIN_SCORE
        if effective_source_name == "CustomCareers" and is_target_firm(company):
            min_score = CUSTOM_CAREERS_MIN_SCORE
        if score < min_score:
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
                fit_score=score,
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


def main(*, skip_enrichment: bool = False, skip_post_hooks: bool = False, scrape_only: bool = False) -> None:
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

    all_jobs.extend(run_source_stage("linkedin", lambda: collect_linkedin_records(session)))
    all_jobs.extend(run_source_stage("greenhouse", lambda: collect_greenhouse_records(session)))
    all_jobs.extend(run_source_stage("lever", lambda: collect_lever_records(session)))
    all_jobs.extend(run_source_stage("smartrecruiters", lambda: collect_smartrecruiters_records(session)))
    all_jobs.extend(run_source_stage("ashby", lambda: collect_ashby_records(session)))
    all_jobs.extend(run_source_stage("workable", lambda: collect_workable_records(session)))
    for source in JOB_BOARD_SOURCES:
        all_jobs.extend(
            run_source_stage(
                f"job_board:{source['name']}",
                lambda source=source: collect_job_board_records(session, source),
            )
        )

    records = run_step("dedupe_records", lambda: dedupe_records(sorted(all_jobs, key=lambda x: x.fit_score, reverse=True)))
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    seen_cache = prune_seen_cache(load_seen_cache(config.SEEN_CACHE_PATH), config.SEEN_CACHE_DAYS)
    records = filter_new_records(records, seen_cache)
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    if not skip_enrichment:
        records = run_step("enhance_records_with_groq", lambda: enhance_records_with_groq(records))
        records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    digest_suffix = "_scrape_only" if scrape_only else ""
    out_xlsx, out_csv = run_step(
        "write_digest_outputs",
        lambda: write_digest_outputs(records, suffix=digest_suffix),
    )
    save_custom_careers_health_state(finalize_custom_target_diagnostics())
    diagnostics_path = write_source_diagnostics(suffix=digest_suffix)

    if not scrape_only:
        run_step("write_records_to_firestore", lambda: write_records_to_firestore(records))
        run_step("write_notifications", lambda: write_notifications(records))
        run_step("write_source_stats", lambda: write_source_stats(records))

    if not scrape_only and not skip_post_hooks:
        run_step("write_role_suggestions", write_role_suggestions)
        run_step("write_candidate_prep", write_candidate_prep)
        run_step("cleanup_stale_jobs", cleanup_stale_jobs)

    if scrape_only:
        print(f"Digest generated: {out_xlsx}")
        print(f"Roles found: {len(records)}")
        print_source_yield(records)
        print_source_health_summary()
        print_recent_digest_forecast()
        if diagnostics_path is not None:
            print(f"Source diagnostics: {diagnostics_path}")
        return

    pipeline_summary_html = ""
    try:
        fs_client = init_firestore_client()
        if fs_client:
            all_docs = fs_client.collection(config.FIREBASE_COLLECTION).stream()
            pipeline_counts = {"saved": 0, "applied": 0, "interview": 0, "offer": 0, "rejected": 0}
            follow_ups_due = []
            today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for d in all_docs:
                data = d.to_dict()
                status = (data.get("application_status") or "saved").lower()
                if status in pipeline_counts:
                    pipeline_counts[status] += 1
                fu = data.get("follow_up_date", "")
                if fu and fu[:10] <= today_str and status not in ("rejected", "offer"):
                    follow_ups_due.append(f"{data.get('role', '?')} at {data.get('company', '?')}")
            pipeline_cells = " | ".join(
                f"<strong>{k.title()}</strong>: {v}" for k, v in pipeline_counts.items()
            )
            pipeline_summary_html = (
                "<div style='background:#EEF2FF; border:1px solid #C7D2FE; padding:12px; "
                "border-radius:8px; margin-bottom:14px; font-size:14px; color:#1E1B4B;'>"
                f"<div style='font-weight:bold; margin-bottom:6px;'>Pipeline Summary</div>"
                f"<div>{pipeline_cells}</div>"
            )
            if follow_ups_due:
                fu_list = ", ".join(follow_ups_due[:5])
                more = f" (+{len(follow_ups_due) - 5} more)" if len(follow_ups_due) > 5 else ""
                pipeline_summary_html += (
                    f"<div style='margin-top:8px; color:#DC2626;'>"
                    f"<strong>Follow-ups due:</strong> {fu_list}{more}</div>"
                )
            pipeline_summary_html += "</div>"
    except Exception:
        pass

    top_pick = select_top_pick(records)
    top_records = records[: config.MAX_EMAIL_ROLES]
    if top_pick and top_pick not in top_records:
        top_records = [top_pick] + top_records
        top_records = top_records[: config.MAX_EMAIL_ROLES]
    html_body = build_email_html(top_records, config.WINDOW_HOURS)
    if pipeline_summary_html and "<h2" in html_body:
        html_body = html_body.replace("</h2>", "</h2>" + pipeline_summary_html, 1)
    text_lines = [
        f"Daily job digest (last {config.WINDOW_HOURS} hours).",
        f"Preferences: {config.PREFERENCES}",
        f"Sources checked: {build_sources_summary()}",
        f"Roles found: {len(records)}",
        "",
    ]
    if top_pick:
        text_lines.append("Top pick:")
        text_lines.append(
            f"- {top_pick.role} | {top_pick.company} | {top_pick.posted} | "
            f"Source {top_pick.source} | Fit {top_pick.fit_score}%"
        )
        text_lines.append(f"  Preference match: {top_pick.preference_match}")
        text_lines.append(f"  Why fit: {top_pick.why_fit}")
        text_lines.append(f"  Potential gaps: {top_pick.cv_gap}")
        text_lines.append(f"  Link: {top_pick.link}")
        text_lines.append("")
    for rec in top_records:
        text_lines.append(
            f"- {rec.role} | {rec.company} | {rec.posted} | "
            f"Source {rec.source} | Fit {rec.fit_score}%"
        )
        text_lines.append(f"  Preference match: {rec.preference_match}")
        text_lines.append(f"  Why fit: {rec.why_fit}")
        text_lines.append(f"  Potential gaps: {rec.cv_gap}")
        text_lines.append(f"  Link: {rec.link}")
        text_lines.append("")
    text_body = "\n".join(text_lines)

    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"Daily Job Digest - {today}"
    email_sent = send_email(subject, html_body, text_body)

    for record in records:
        if record.link:
            seen_cache[record.link] = now_utc().isoformat()
        for alt in record.alternate_links:
            link = alt.get("link") if isinstance(alt, dict) else ""
            if link:
                seen_cache[link] = now_utc().isoformat()
    save_seen_cache(config.SEEN_CACHE_PATH, seen_cache)
    if config.RUN_AT or config.RUN_ATS:
        state = load_run_state(config.RUN_STATE_PATH)
        now_local = datetime.now(ZoneInfo(config.TZ_NAME)) if ZoneInfo else datetime.now()
        run_times = [t for t in config.RUN_ATS if _parse_run_time(t)] or ([config.RUN_AT] if config.RUN_AT else [])
        last_slots = state.get("last_run_slots", [])
        if not isinstance(last_slots, list):
            last_slots = []
        for run_time in run_times or ["manual"]:
            parsed = _parse_run_time(run_time) if run_time != "manual" else None
            if parsed:
                hour, minute = parsed
                slot_key = f"{now_local.strftime('%Y-%m-%d')}-{hour:02d}:{minute:02d}"
            else:
                slot_key = f"{now_local.strftime('%Y-%m-%d')}-manual"
            if slot_key not in last_slots:
                last_slots.append(slot_key)
        state["last_run_slots"] = last_slots[-50:]
        save_run_state(config.RUN_STATE_PATH, state)

    print(f"Digest generated: {out_xlsx}")
    print(f"Roles found: {len(records)}")
    print_source_yield(records)
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
    args = parser.parse_args()

    if args.smoke_test:
        run_smoke_test()
    elif args.backfill_diagnose:
        diagnose_backfill()
    elif args.backfill_posted_dates:
        backfill_posted_dates(limit=args.backfill_limit or None)
    elif args.backfill_role_summary:
        backfill_role_summaries(limit=args.backfill_limit or None)
    else:
        if not should_run_now(force=args.force):
            print("Skipping run: outside scheduled run window or already sent for this slot.")
            raise SystemExit(0)
        main(
            skip_enrichment=args.skip_enrichment or args.scrape_only,
            skip_post_hooks=args.skip_post_hooks or args.scrape_only,
            scrape_only=args.scrape_only,
        )


if __name__ == "__main__":
    cli()
