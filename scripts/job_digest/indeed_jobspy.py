from __future__ import annotations

import os
from datetime import datetime
from typing import Dict, List, Tuple

import pandas as pd

from .config import BANK_COMPANIES, FINTECH_COMPANIES, SEARCH_COMPANIES, select_company_batch
from .utils import clean_link, normalize_text, trim_summary

try:
    from jobspy import scrape_jobs
except Exception as exc:  # noqa: BLE001
    scrape_jobs = None
    JOBSPY_IMPORT_ERROR = exc
else:
    JOBSPY_IMPORT_ERROR = None


def _get_value(row: dict, *keys: str) -> object:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return ""


def _normalize_date(value: object) -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime().isoformat()
        except Exception:  # noqa: BLE001
            return str(value)
    if isinstance(value, pd.Timestamp):
        try:
            return value.to_pydatetime().isoformat()
        except Exception:  # noqa: BLE001
            return str(value)
    return str(value).strip()


def _normalize_salary(value: object) -> str:
    if value in (None, ""):
        return ""
    try:
        numeric = float(value)
        if numeric.is_integer():
            return str(int(numeric))
        return str(numeric)
    except Exception:  # noqa: BLE001
        return str(value).strip()


def _select_indeed_companies(limit: int) -> list[str]:
    candidates = select_company_batch(SEARCH_COMPANIES)
    banks: list[str] = []
    fintechs: list[str] = []
    others: list[str] = []

    for company in candidates:
        normalized = normalize_text(company).lower()
        if normalized in BANK_COMPANIES:
            banks.append(company)
        elif normalized in FINTECH_COMPANIES:
            fintechs.append(company)
        else:
            others.append(company)

    selected: list[str] = []
    buckets = [banks, fintechs, others]
    while len(selected) < limit and any(buckets):
        for bucket in buckets:
            if not bucket or len(selected) >= limit:
                continue
            selected.append(bucket.pop(0))
    return selected


def _build_query_plan() -> tuple[list[tuple[str, str]], dict[str, int]]:
    company_limit = int(os.getenv("JOB_DIGEST_INDEED_JOBSPY_COMPANY_LIMIT", "6") or "6")
    term_limit = int(os.getenv("JOB_DIGEST_INDEED_JOBSPY_TERM_LIMIT", "3") or "3")
    company_location = (os.getenv("JOB_DIGEST_INDEED_JOBSPY_LOCATION", "London") or "London").strip()
    adjacent_enabled = os.getenv("JOB_DIGEST_INDEED_JOBSPY_INCLUDE_ADJACENT", "false").lower() == "true"
    adjacent_location = (os.getenv("JOB_DIGEST_INDEED_JOBSPY_ADJACENT_LOCATION", "London") or "London").strip()
    company_terms = (
        "product manager",
        "product owner",
        "product management",
    )[:term_limit]
    adjacent_terms = (
        "financial crime product manager",
        "client onboarding product manager",
    )

    queries: list[tuple[str, str]] = []
    company_queries = 0
    adjacent_queries = 0

    for company in _select_indeed_companies(company_limit):
        for term in company_terms:
            queries.append((f"{company} {term}", company_location))
            company_queries += 1

    if adjacent_enabled:
        for term in adjacent_terms:
            queries.append((term, adjacent_location))
            adjacent_queries += 1

    return queries, {
        "query_count": len(queries),
        "company_query_count": company_queries,
        "adjacent_query_count": adjacent_queries,
    }


def jobspy_indeed_search() -> tuple[List[Dict[str, str]], Dict[str, object]]:
    meta: Dict[str, object] = {
        "mode": "jobspy",
        "raw": 0,
        "failed": 0,
        "notes": [],
        "query_count": 0,
        "company_query_count": 0,
        "adjacent_query_count": 0,
    }
    if scrape_jobs is None:
        meta["failed"] = 1
        meta["notes"] = [f"python-jobspy not installed: {JOBSPY_IMPORT_ERROR}"]
        return [], meta

    queries, counts = _build_query_plan()
    meta.update(counts)

    results_wanted = int(os.getenv("JOB_DIGEST_INDEED_RESULTS_WANTED", "10") or "10")
    hours_old = int(os.getenv("JOB_DIGEST_INDEED_HOURS_OLD", "24") or "24")
    country_indeed = (os.getenv("JOB_DIGEST_INDEED_COUNTRY", "uk") or "uk").strip().lower()
    proxy_url = (os.getenv("JOB_DIGEST_INDEED_JOBSPY_PROXY_URL", "") or os.getenv("JOB_DIGEST_INDEED_PROXY_URL", "")).strip()

    jobs_by_link: dict[str, Dict[str, str]] = {}
    failure_count = 0

    for query, location in queries:
        try:
            frame = scrape_jobs(
                site_name=["indeed"],
                search_term=query,
                location=location,
                distance=25,
                results_wanted=results_wanted,
                hours_old=hours_old,
                country_indeed=country_indeed,
                proxies=proxy_url or None,
            )
        except Exception as exc:  # noqa: BLE001
            failure_count += 1
            notes = meta.setdefault("notes", [])
            note = f"jobspy query failed for {query} @ {location}: {exc}"
            if note not in notes:
                notes.append(note)
            continue

        if frame is None:
            continue

        try:
            rows = frame.to_dict(orient="records")
        except Exception:  # noqa: BLE001
            try:
                rows = list(frame)
            except Exception:  # noqa: BLE001
                rows = []

        meta["raw"] = int(meta.get("raw", 0) or 0) + len(rows)

        for row in rows:
            link = clean_link(str(_get_value(row, "job_url", "job_url_direct", "url", "link") or ""))
            title = normalize_text(str(_get_value(row, "title", "job_title") or ""))
            if not link or not title:
                continue

            normalized = {
                "title": title,
                "company": normalize_text(str(_get_value(row, "company", "company_name", "companyName") or "Indeed")),
                "location": normalize_text(str(_get_value(row, "location", "job_location", "city") or location or "United Kingdom")),
                "link": link,
                "posted_text": normalize_text(str(_get_value(row, "date_posted_human_readable", "date_posted_text", "posted_text") or "")),
                "posted_date": _normalize_date(_get_value(row, "date_posted", "posted_date")),
                "summary": trim_summary(str(_get_value(row, "description", "job_description", "summary", "snippet") or "")),
                "salary_min": _normalize_salary(_get_value(row, "min_amount", "salary_min", "salary_amount_min")),
                "salary_max": _normalize_salary(_get_value(row, "max_amount", "salary_max", "salary_amount_max")),
                "source": "IndeedUK",
            }

            existing = jobs_by_link.get(link)
            if not existing:
                jobs_by_link[link] = normalized
                continue

            if normalized["posted_date"] and not existing.get("posted_date"):
                existing["posted_date"] = normalized["posted_date"]
            if normalized["posted_text"] and not existing.get("posted_text"):
                existing["posted_text"] = normalized["posted_text"]
            if normalized["summary"] and len(normalized["summary"]) > len(existing.get("summary", "")):
                existing["summary"] = normalized["summary"]
            if normalized["company"] and existing.get("company") in {"", "Indeed"}:
                existing["company"] = normalized["company"]
            if normalized["location"] and existing.get("location") in {"", "United Kingdom"}:
                existing["location"] = normalized["location"]
            if normalized["salary_min"] and not existing.get("salary_min"):
                existing["salary_min"] = normalized["salary_min"]
            if normalized["salary_max"] and not existing.get("salary_max"):
                existing["salary_max"] = normalized["salary_max"]

    if proxy_url:
        notes = meta.setdefault("notes", [])
        if "jobspy used proxy" not in notes:
            notes.append("jobspy used proxy")

    if failure_count:
        notes = meta.setdefault("notes", [])
        notes.append(f"jobspy query failures: {failure_count}")
    if failure_count and not jobs_by_link:
        meta["failed"] = 1

    return list(jobs_by_link.values()), meta
