from __future__ import annotations

import argparse
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from . import config
from .boards import JOB_BOARD_SOURCES
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
    reed_search,
    remotive_search,
    remoteok_search,
    rss_search,
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
    previous_handler = signal.getsignal(signal.SIGALRM)
    try:
        if SOURCE_STAGE_TIMEOUT_SECONDS > 0:
            signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(SOURCE_STAGE_TIMEOUT_SECONDS)
        records = fn()
        elapsed = time.perf_counter() - started
        log_trace(f"[source] {label} complete in {elapsed:.1f}s with {len(records)} kept roles")
        return records
    except SourceStageTimeoutError:
        elapsed = time.perf_counter() - started
        log_trace(f"[source] {label} timed out after {elapsed:.1f}s; skipping")
        return []
    except Exception as exc:  # noqa: BLE001
        elapsed = time.perf_counter() - started
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

        summary = desc_text[:500]
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
    return records


def collect_greenhouse_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    greenhouse_jobs = greenhouse_search(session)
    print(f"[Greenhouse] {len(greenhouse_jobs)} raw results fetched (before filtering)")
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
    return records


def collect_lever_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    lever_jobs = lever_search(session)
    print(f"[Lever] {len(lever_jobs)} raw results fetched (before filtering)")
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
    return records


def collect_smartrecruiters_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    smart_jobs = smartrecruiters_search(session)
    print(f"[SmartRecruiters] {len(smart_jobs)} raw results fetched (before filtering)")
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
    return records


def collect_ashby_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    ashby_jobs = ashby_search(session)
    print(f"[Ashby] {len(ashby_jobs)} raw results fetched (before filtering)")
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
    return records


def collect_workable_records(session: requests.Session) -> list[JobRecord]:
    records: list[JobRecord] = []
    workable_jobs = workable_search(session)
    print(f"[Workable] {len(workable_jobs)} raw results fetched (before filtering)")
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
    board_jobs = collect_job_board_source(session, source)
    print(f"[Job boards:{source['name']}] {len(board_jobs)} raw results fetched (before filtering)")
    for job in board_jobs:
        title = job.get("title", "")
        company = canonical_company(job.get("company", ""))
        location = job.get("location", "") or "Remote"
        if not is_relevant_title(title):
            continue
        summary = job.get("summary", "")
        if not is_relevant_location(location, summary):
            continue
        if not should_keep_role_company(company, "JobBoard", job.get("source", "Job board")):
            continue

        posted_display, posted_raw, posted_date = normalize_posted(job)
        if not parse_posted_within_window(posted_raw or posted_display, posted_date, config.WINDOW_HOURS):
            continue

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
                source=job.get("source", "Job board"),
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
    return records

try:
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001
    ZoneInfo = None


def main(*, skip_enrichment: bool = False, skip_post_hooks: bool = False, scrape_only: bool = False) -> None:
    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})

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

    subject = f"Daily Job Digest - {today}"
    email_sent = send_email(subject, html_body, text_body)

    if email_sent:
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
