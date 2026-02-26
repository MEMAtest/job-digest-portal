from __future__ import annotations

import argparse
from datetime import datetime, timezone

import pandas as pd
import requests

from . import config
from .firestore import (
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
    ashby_search,
    build_manual_record,
    greenhouse_search,
    job_board_search,
    lever_search,
    linkedin_job_details,
    linkedin_search,
    smartrecruiters_search,
)
from .summary import build_email_html, build_sources_summary, send_email
from .utils import (
    filter_new_records,
    load_run_state,
    load_seen_cache,
    now_utc,
    parse_posted_within_window,
    prune_seen_cache,
    save_run_state,
    save_seen_cache,
    select_top_pick,
    should_run_now,
    _parse_run_time,
)

try:
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001
    ZoneInfo = None


def main() -> None:
    if not should_run_now():
        print("Skipping run: outside scheduled run window or already sent today.")
        return

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

    linkedin_jobs = linkedin_search(session)
    for job in linkedin_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "")
        if not is_relevant_title(title):
            continue

        desc_text, posted_detail, detail_location, applicant_text = linkedin_job_details(session, job["job_id"])
        if detail_location:
            location = detail_location
        if not is_relevant_location(location, desc_text):
            continue

        posted_text = posted_detail or job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        summary = desc_text[:500]
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)

        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text,
                posted_raw=posted_text,
                posted_date=posted_date,
                source="LinkedIn",
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
                applicant_count=applicant_text,
            )
        )

    greenhouse_jobs = greenhouse_search(session)
    for job in greenhouse_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "")
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue

        posted_text = job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text or posted_date,
                posted_raw=posted_text or posted_date,
                posted_date=posted_date,
                source="Greenhouse",
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
            )
        )

    lever_jobs = lever_search(session)
    for job in lever_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "")
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue

        posted_text = job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text or posted_date,
                posted_raw=posted_text or posted_date,
                posted_date=posted_date,
                source="Lever",
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
            )
        )

    smart_jobs = smartrecruiters_search(session)
    for job in smart_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "")
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue

        posted_text = job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text or posted_date,
                posted_raw=posted_text or posted_date,
                posted_date=posted_date,
                source="SmartRecruiters",
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
            )
        )

    ashby_jobs = ashby_search(session)
    for job in ashby_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "") or "Remote"
        if not is_relevant_title(title):
            continue
        if not is_relevant_location(location):
            continue

        posted_text = job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        summary = job.get("summary", "")
        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text or posted_date,
                posted_raw=posted_text or posted_date,
                posted_date=posted_date,
                source="Ashby",
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
            )
        )

    board_jobs = job_board_search(session)
    for job in board_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        location = job.get("location", "") or "Remote"
        if not is_relevant_title(title):
            continue
        summary = job.get("summary", "")
        if not is_relevant_location(location, summary):
            continue

        posted_text = job.get("posted_text", "")
        posted_date = job.get("posted_date", "")
        if not parse_posted_within_window(posted_text, posted_date, config.WINDOW_HOURS):
            continue

        full_text = f"{title} {company} {summary}"
        score, _, _ = score_fit(full_text, company)
        if score < config.MIN_SCORE:
            continue

        why_fit = build_reasons(full_text)
        cv_gap = build_gaps(full_text)
        preference_match = build_preference_match(full_text, company, location)

        all_jobs.append(
            JobRecord(
                role=title,
                company=company,
                location=location,
                link=job.get("link", ""),
                posted=posted_text or posted_date,
                posted_raw=posted_text or posted_date,
                posted_date=posted_date,
                source=job.get("source", "Job board"),
                fit_score=score,
                preference_match=preference_match,
                why_fit=why_fit,
                cv_gap=cv_gap,
                notes=summary,
            )
        )

    records = dedupe_records(sorted(all_jobs, key=lambda x: x.fit_score, reverse=True))
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    seen_cache = prune_seen_cache(load_seen_cache(config.SEEN_CACHE_PATH), config.SEEN_CACHE_DAYS)
    records = filter_new_records(records, seen_cache)
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    records = enhance_records_with_groq(records)
    records = sorted(records, key=lambda record: record.fit_score, reverse=True)

    write_records_to_firestore(records)
    write_notifications(records)
    write_source_stats(records)
    write_role_suggestions()
    write_candidate_prep()
    cleanup_stale_jobs()

    today = datetime.now().strftime("%Y-%m-%d")
    out_xlsx = config.DIGEST_DIR / f"digest_{today}.xlsx"
    out_csv = config.DIGEST_DIR / f"digest_{today}.csv"

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

    if not df.empty:
        df.to_excel(out_xlsx, index=False)
        df.to_csv(out_csv, index=False)
    else:
        df.to_excel(out_xlsx, index=False)
        df.to_csv(out_csv, index=False)

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
    args = parser.parse_args()

    if args.smoke_test:
        run_smoke_test()
    elif args.backfill_diagnose:
        diagnose_backfill()
    elif args.backfill_role_summary:
        backfill_role_summaries(limit=args.backfill_limit or None)
    else:
        if not should_run_now(force=args.force):
            print("Skipping run: outside scheduled run window or already sent for this slot.")
            raise SystemExit(0)
        main()


if __name__ == "__main__":
    cli()
