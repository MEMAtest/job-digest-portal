from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
try:
    from google.cloud.firestore_v1.base_query import FieldFilter
except Exception:  # noqa: BLE001
    FieldFilter = None

from .boards import (
    ASHBY_BOARDS,
    GREENHOUSE_BOARDS,
    JOB_BOARD_SOURCES,
    JOB_BOARD_URLS,
    LEVER_BOARDS,
    SMARTRECRUITERS_COMPANIES,
    WORKABLE_ACCOUNTS,
    WORKDAY_SITES,
)
from . import config
from .config import (
    ADZUNA_APP_ID,
    ADZUNA_APP_KEY,
    BOARD_KEYWORDS,
    BROAD_BOARD_KEYWORDS,
    COMPANY_SEARCH_TERMS,
    CV_LIBRARY_API_KEY,
    EXCLUDE_COMPANIES,
    JOOBLE_API_KEY,
    REED_API_KEY,
    SEARCH_COMPANIES,
    SEARCH_KEYWORDS,
    SEARCH_LOCATIONS,
    UK_FEEDS_PATH,
    USER_AGENT,
    select_company_batch,
)
from .models import JobRecord
from .indeed_jobspy import jobspy_indeed_search
from .scoring import assess_fit, build_gaps, build_preference_match, build_reasons, score_fit
from .utils import canonicalize_posted_fields, clean_link, extract_relative_posted_text, normalize_text, trim_summary

try:
    import feedparser
except Exception:  # noqa: BLE001
    feedparser = None

SOURCE_RUNTIME_EVENTS: Dict[str, Dict[str, object]] = {}
CUSTOM_CAREERS_HEALTH_PATH = config.DIGEST_DIR / "custom_careers_health.json"
CUSTOM_CAREERS_GENERIC_PAGE_PATTERN = re.compile(
    r"job openings at|job opportunities at|search\s*&\s*apply|search and apply|careers?$|career opportunities|"
    r"campus events|all jobs|open roles|join our team|join us|students|graduates|internships|military spouses|veterans|"
    r"vacant positions|share on facebook|share on linkedin|share on x|opens a new window|disabilities in the workplace|"
    r"be you\. be valued\. belong",
    re.IGNORECASE,
)
CUSTOM_CAREERS_SKIP_PATH_PATTERN = re.compile(
    r"/events?/|/event-|/students|/graduates|/intern|/veteran|/disabilit|/benefit|/culture|/life-at-|/share|facebook|linkedin|twitter|x\\.com",
    re.IGNORECASE,
)
CUSTOM_CAREERS_NON_UK_PATH_PATTERN = re.compile(
    r"/(pune|noida|chennai|tokyo|tel-aviv|gurugram|mumbai|hyderabad|bangalore|bengaluru|india|singapore|sydney|melbourne|hong-kong|hongkong|japan|israel)/",
    re.IGNORECASE,
)


def reset_source_runtime_events() -> None:
    SOURCE_RUNTIME_EVENTS.clear()


def mark_source_runtime_event(
    source_name: str,
    *,
    blocked: int = 0,
    timed_out: int = 0,
    failed: int = 0,
    raw: int | None = None,
    note: str = "",
    mode: str = "",
    query_count: int | None = None,
    company_query_count: int | None = None,
    adjacent_query_count: int | None = None,
) -> None:
    state = SOURCE_RUNTIME_EVENTS.setdefault(
        source_name,
        {
            "blocked": 0,
            "timed_out": 0,
            "failed": 0,
            "raw": 0,
            "notes": [],
            "mode": "",
            "query_count": 0,
            "company_query_count": 0,
            "adjacent_query_count": 0,
        },
    )
    state["blocked"] = int(state.get("blocked", 0) or 0) + blocked
    state["timed_out"] = int(state.get("timed_out", 0) or 0) + timed_out
    state["failed"] = int(state.get("failed", 0) or 0) + failed
    if raw is not None:
        state["raw"] = max(int(state.get("raw", 0) or 0), int(raw))
    if mode:
        state["mode"] = mode
    if query_count is not None:
        state["query_count"] = max(int(state.get("query_count", 0) or 0), int(query_count))
    if company_query_count is not None:
        state["company_query_count"] = max(int(state.get("company_query_count", 0) or 0), int(company_query_count))
    if adjacent_query_count is not None:
        state["adjacent_query_count"] = max(int(state.get("adjacent_query_count", 0) or 0), int(adjacent_query_count))
    if note:
        notes = state.setdefault("notes", [])
        if note not in notes:
            notes.append(note)


def get_source_runtime_events() -> Dict[str, Dict[str, object]]:
    return {
        name: {
            "blocked": int(payload.get("blocked", 0) or 0),
            "timed_out": int(payload.get("timed_out", 0) or 0),
            "failed": int(payload.get("failed", 0) or 0),
            "raw": int(payload.get("raw", 0) or 0),
            "notes": list(payload.get("notes", []) or []),
            "mode": str(payload.get("mode", "") or ""),
            "query_count": int(payload.get("query_count", 0) or 0),
            "company_query_count": int(payload.get("company_query_count", 0) or 0),
            "adjacent_query_count": int(payload.get("adjacent_query_count", 0) or 0),
        }
        for name, payload in SOURCE_RUNTIME_EVENTS.items()
    }


def load_custom_careers_health_state() -> Dict[str, Dict[str, object]]:
    if not CUSTOM_CAREERS_HEALTH_PATH.exists():
        return {}
    try:
        payload = json.loads(CUSTOM_CAREERS_HEALTH_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def save_custom_careers_health_state(state: Dict[str, Dict[str, object]]) -> None:
    if not state:
        return
    existing = load_custom_careers_health_state()
    merged = dict(existing)
    merged.update(state)
    try:
        CUSTOM_CAREERS_HEALTH_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        return


def is_generic_custom_careers_title(title: str) -> bool:
    return bool(CUSTOM_CAREERS_GENERIC_PAGE_PATTERN.search(normalize_text(title or "")))


def should_skip_custom_careers_page(title: str, link: str = "", summary: str = "") -> bool:
    title_norm = normalize_text(title or "")
    summary_norm = normalize_text(summary or "")
    link_norm = (link or "").lower()
    if is_generic_custom_careers_title(title_norm):
        return True
    if link_norm and CUSTOM_CAREERS_SKIP_PATH_PATTERN.search(link_norm):
        return True
    business_line_titles = {
        "financial institutions",
        "government agencies",
        "public sector",
        "accounting firms",
        "crypto businesses",
        "solutions",
        "industries",
        "our customers",
        "platform",
        "products",
    }
    if title_norm.lower() in business_line_titles:
        return True
    hiring_markers = (
        "responsibilities",
        "requirements",
        "qualifications",
        "job description",
        "about the role",
        "what you'll do",
        "what you will do",
        "experience",
        "apply now",
    )
    role_shape_markers = (
        "manager",
        "analyst",
        "lead",
        "director",
        "specialist",
        "engineer",
        "owner",
        "associate",
        "officer",
        "consultant",
        "partner",
        "head of",
        "vice president",
    )
    combined = f"{title_norm} {summary_norm}".lower()
    if not any(marker in combined for marker in hiring_markers) and not any(marker in title_norm.lower() for marker in role_shape_markers):
        return True
    generic_summary_markers = (
        "search and apply for jobs directly",
        "supporting people with disabilities",
        "community where you'll truly belong",
        "start your unobvious career",
    )
    return any(marker in summary_norm.lower() for marker in generic_summary_markers)


def custom_careers_url_penalty(careers_url: str) -> int:
    url = (careers_url or "").lower()
    penalty = 0
    if any(token in url for token in ("/usa/", "/us/", "/united-states/", "/india/", "/australia/", "/singapore/", "/japan/")):
        penalty += 2
    if any(token in url for token in ("/global/", "/worldwide/", "/international/")):
        penalty += 1
    if any(token in url for token in (".co.uk", "/uk/", "united-kingdom", "london")):
        penalty -= 1
    return penalty


def is_obvious_non_uk_custom_link(link: str) -> bool:
    return bool(CUSTOM_CAREERS_NON_UK_PATH_PATTERN.search((link or "").lower()))

def _merge_linkedin_card(existing: Dict[str, str], incoming: Dict[str, str]) -> Dict[str, str]:
    if not existing:
        return incoming
    merged = dict(existing)
    for key in ("title", "company", "location", "link"):
        if incoming.get(key) and not merged.get(key):
            merged[key] = incoming[key]
    if incoming.get("posted_date"):
        merged["posted_date"] = incoming["posted_date"]
    if incoming.get("posted_text") and (not merged.get("posted_text") or not merged.get("posted_date")):
        merged["posted_text"] = incoming["posted_text"]
    return merged


def linkedin_search(session: requests.Session) -> List[Dict[str, str]]:
    base_url = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    headers = {"User-Agent": USER_AGENT}
    jobs: Dict[str, Dict[str, str]] = {}
    deadline_seconds = int(os.getenv("JOB_DIGEST_LINKEDIN_DEADLINE_SECONDS", "120") or "120")
    started = time.monotonic()

    def deadline_reached() -> bool:
        return deadline_seconds > 0 and (time.monotonic() - started) >= deadline_seconds

    def request_timeout() -> int:
        if deadline_seconds <= 0:
            return 20
        remaining = deadline_seconds - int(time.monotonic() - started)
        return max(5, min(20, remaining))

    for keywords in SEARCH_KEYWORDS:
        for location in SEARCH_LOCATIONS:
            for start in [0, 25]:
                if deadline_reached():
                    return list(jobs.values())
                params = {
                    "keywords": keywords,
                    "location": location,
                    "f_TPR": "r604800",
                    "start": start,
                }
                try:
                    resp = session.get(base_url, params=params, headers=headers, timeout=request_timeout())
                except requests.RequestException:
                    continue
                if resp.status_code != 200:
                    continue

                soup = BeautifulSoup(resp.text, "html.parser")
                for card in soup.select("div.base-search-card"):
                    job_urn = card.get("data-entity-urn", "")
                    job_id = job_urn.split(":")[-1]
                    if not job_id:
                        continue

                    title_el = card.select_one("h3.base-search-card__title")
                    company_el = card.select_one("h4.base-search-card__subtitle")
                    location_el = card.select_one("span.job-search-card__location")
                    time_el = card.select_one("time")
                    link_el = card.select_one("a.base-card__full-link")

                    title = normalize_text(title_el.get_text()) if title_el else ""
                    company = normalize_text(company_el.get_text()) if company_el else ""
                    location_text = normalize_text(location_el.get_text()) if location_el else ""
                    posted_text = normalize_text(time_el.get_text()) if time_el else ""
                    posted_date = time_el.get("datetime") if time_el else ""
                    link = link_el.get("href") if link_el else ""

                    if not title or not company:
                        continue
                    if company.lower() in EXCLUDE_COMPANIES:
                        continue

                    jobs[job_id] = _merge_linkedin_card(jobs.get(job_id, {}), {
                        "job_id": job_id,
                        "title": title,
                        "company": company,
                        "location": location_text,
                        "posted_text": posted_text,
                        "posted_date": posted_date,
                        "link": clean_link(link),
                    })

                if deadline_reached():
                    return list(jobs.values())
                time.sleep(0.3)

    # Company-focused searches (narrower paging to reduce load)
    for company in select_company_batch(SEARCH_COMPANIES):
        for base_term in COMPANY_SEARCH_TERMS:
            keywords = f"{base_term} {company}"
            for location in SEARCH_LOCATIONS:
                for start in [0]:
                    if deadline_reached():
                        return list(jobs.values())
                    params = {
                        "keywords": keywords,
                        "location": location,
                        "f_TPR": "r604800",
                        "start": start,
                    }
                    try:
                        resp = session.get(base_url, params=params, headers=headers, timeout=request_timeout())
                    except requests.RequestException:
                        continue
                    if resp.status_code != 200:
                        continue

                    soup = BeautifulSoup(resp.text, "html.parser")
                    for card in soup.select("div.base-search-card"):
                        job_urn = card.get("data-entity-urn", "")
                        job_id = job_urn.split(":")[-1]
                        if not job_id:
                            continue

                        title_el = card.select_one("h3.base-search-card__title")
                        company_el = card.select_one("h4.base-search-card__subtitle")
                        location_el = card.select_one("span.job-search-card__location")
                        time_el = card.select_one("time")
                        link_el = card.select_one("a.base-card__full-link")

                        title = normalize_text(title_el.get_text()) if title_el else ""
                        company_name = normalize_text(company_el.get_text()) if company_el else ""
                        location_text = normalize_text(location_el.get_text()) if location_el else ""
                        posted_text = normalize_text(time_el.get_text()) if time_el else ""
                        posted_date = time_el.get("datetime") if time_el else ""
                        link = link_el.get("href") if link_el else ""

                        if not title or not company_name:
                            continue
                        if company_name.lower() in EXCLUDE_COMPANIES:
                            continue

                        jobs[job_id] = _merge_linkedin_card(jobs.get(job_id, {}), {
                            "job_id": job_id,
                            "title": title,
                            "company": company_name,
                            "location": location_text,
                            "posted_text": posted_text,
                            "posted_date": posted_date,
                            "link": clean_link(link),
                        })

                    if deadline_reached():
                        return list(jobs.values())
                    time.sleep(0.2)

    return list(jobs.values())


def linkedin_job_details(session: requests.Session, job_id: str, timeout: int = 20) -> Dict[str, str]:
    detail_url = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    headers = {"User-Agent": USER_AGENT}
    try:
        resp = session.get(detail_url, headers=headers, timeout=timeout)
    except requests.RequestException:
        return {}
    if resp.status_code != 200:
        return {}

    soup = BeautifulSoup(resp.text, "html.parser")
    desc_el = soup.select_one("div.show-more-less-html__markup")
    desc_text = normalize_text(desc_el.get_text(" ")) if desc_el else ""

    title_el = soup.select_one("h2.top-card-layout__title, h1.top-card-layout__title, h2.topcard__title")
    title_text = normalize_text(title_el.get_text(" ")) if title_el else ""

    company_el = soup.select_one("a.topcard__org-name-link")
    if not company_el:
        company_el = soup.select_one("span.topcard__flavor a")
    if not company_el:
        company_el = soup.select_one("a.topcard__flavor")
    company_text = normalize_text(company_el.get_text(" ")) if company_el else ""

    posted_el = soup.select_one("span.posted-time-ago__text")
    posted_text = normalize_text(posted_el.get_text()) if posted_el else ""
    posted_time_el = soup.select_one("time")
    posted_date = posted_time_el.get("datetime") if posted_time_el else ""

    loc_el = soup.select_one("span.topcard__flavor--bullet")
    location_text = normalize_text(loc_el.get_text()) if loc_el else ""

    applicant_el = (
        soup.select_one("span.num-applicants__caption")
        or soup.select_one("figcaption.num-applicants__caption")
    )
    applicant_text = normalize_text(applicant_el.get_text()) if applicant_el else ""

    return {
        "description": desc_text,
        "title": title_text,
        "company": company_text,
        "posted_text": posted_text,
        "posted_date": posted_date,
        "location": location_text,
        "applicant_text": applicant_text,
    }


def greenhouse_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for board in GREENHOUSE_BOARDS:
        url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs"
        try:
            resp = session.get(url, timeout=20)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        data = resp.json()
        for job in data.get("jobs", []):
            title = job.get("title", "")
            if not title:
                continue
            company = board.replace("-", " ").title()
            location = (job.get("location") or {}).get("name", "")
            link = job.get("absolute_url", "")
            updated_at = job.get("updated_at", "")
            jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": location,
                    "link": link,
                    "posted_text": "",
                    "posted_date": updated_at,
                    "ats_account": board,
                }
            )
    return jobs


def lever_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for board in LEVER_BOARDS:
        url = f"https://api.lever.co/v0/postings/{board}?mode=json"
        try:
            resp = session.get(url, timeout=20)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        if not isinstance(data, list):
            continue
        for job in data:
            title = job.get("text", "") or job.get("title", "")
            if not title:
                continue
            company = board.replace("-", " ").title()
            location = ""
            if isinstance(job.get("categories"), dict):
                location = job["categories"].get("location", "") or ""
            link = job.get("hostedUrl") or job.get("applyUrl") or ""
            posted_ms = job.get("createdAt")
            posted_date = ""
            if posted_ms:
                try:
                    posted_date = datetime.fromtimestamp(posted_ms / 1000, tz=timezone.utc).isoformat()
                except (OSError, ValueError):
                    posted_date = ""
            jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": location,
                    "link": link,
                    "posted_text": "",
                    "posted_date": posted_date,
                    "ats_account": board,
                }
            )
    return jobs


def ashby_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for board in ASHBY_BOARDS:
        url = f"https://api.ashbyhq.com/posting-api/job-board/{board}"
        try:
            resp = session.get(url, timeout=20)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        postings = data.get("jobs") or data.get("postings") or []
        if not isinstance(postings, list):
            continue
        for job in postings:
            title = job.get("title", "")
            if not title:
                continue
            company = job.get("companyName") or board.replace("-", " ").title()
            location = (
                job.get("location")
                or job.get("locationText")
                or job.get("locationName")
                or ""
            )
            link = (
                job.get("jobUrl")
                or job.get("jobPageUrl")
                or job.get("applyUrl")
                or ""
            )
            posted_date = job.get("publishedAt") or job.get("createdAt") or ""
            jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": location,
                    "link": link,
                    "posted_text": "",
                    "posted_date": posted_date,
                    "ats_account": board,
                }
            )
    return jobs


def _workable_text(value: object) -> str:
    if isinstance(value, str):
        return normalize_text(BeautifulSoup(value, "html.parser").get_text(" "))
    if isinstance(value, list):
        parts = [_workable_text(item) for item in value]
        return normalize_text(" ".join(part for part in parts if part))
    if isinstance(value, dict):
        preferred_keys = [
            "city",
            "region",
            "country",
            "name",
            "location",
            "locationStr",
            "locationName",
            "workplaceType",
            "workplace_type",
            "description",
            "text",
            "value",
        ]
        parts = []
        for key in preferred_keys:
            part = _workable_text(value.get(key))
            if part:
                parts.append(part)
        return normalize_text(", ".join(parts)) if parts else ""
    return ""


def iter_workable_jobs(data: object) -> Iterable[Dict[str, object]]:
    if isinstance(data, dict):
        title = data.get("title") or data.get("name")
        shortcode = data.get("shortcode") or data.get("shortCode") or data.get("code")
        link = (
            data.get("url")
            or data.get("shortlink")
            or data.get("applyUrl")
            or data.get("application_url")
            or data.get("jobUrl")
        )
        if isinstance(title, str) and (isinstance(shortcode, str) or isinstance(link, str)):
            yield data
        for value in data.values():
            yield from iter_workable_jobs(value)
    elif isinstance(data, list):
        for item in data:
            yield from iter_workable_jobs(item)


def workable_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    seen_links: set[str] = set()

    for account in WORKABLE_ACCOUNTS:
        payload = None
        urls = [
            f"https://www.workable.com/api/accounts/{account}?details=true",
            f"https://apply.workable.com/api/v1/widget/accounts/{account}",
            f"https://apply.workable.com/api/v1/widget/accounts/{account}?details=true",
        ]
        for url in urls:
            try:
                resp = session.get(url, timeout=20)
            except requests.RequestException:
                continue
            if resp.status_code != 200:
                continue
            try:
                payload = resp.json()
            except ValueError:
                payload = None
            if payload:
                break
        if not payload:
            continue

        default_company = account.replace("-", " ").title()
        company_name = (
            payload.get("name")
            or payload.get("company")
            or payload.get("companyName")
            or default_company
        )

        for job in iter_workable_jobs(payload):
            title = str(job.get("title") or job.get("name") or "").strip()
            if not title:
                continue

            status = str(job.get("state") or job.get("status") or job.get("jobStatus") or "").lower()
            if status and status not in {"active", "live", "open", "published"}:
                continue

            shortcode = str(job.get("shortcode") or job.get("shortCode") or job.get("code") or "").strip()
            link = (
                job.get("url")
                or job.get("shortlink")
                or job.get("applyUrl")
                or job.get("application_url")
                or job.get("jobUrl")
                or ""
            )
            if not link and shortcode:
                link = f"https://apply.workable.com/{account}/j/{shortcode}/"
            link = clean_link(str(link))
            if not link or link in seen_links:
                continue
            seen_links.add(link)

            city = str(job.get("city") or "").strip()
            country = str(job.get("country") or "").strip()
            location = (
                _workable_text(job.get("location"))
                or _workable_text(job.get("locations"))
                or _workable_text(job.get("locationStr"))
                or _workable_text(job.get("locationName"))
                or _workable_text(job.get("workplaceType"))
                or _workable_text(job.get("workplace_type"))
                or ", ".join(p for p in [city, country] if p)
                or ""
            )
            posted_date = (
                str(
                    job.get("published")
                    or job.get("publishedAt")
                    or job.get("published_at")
                    or job.get("updated_at")
                    or job.get("created_at")
                    or job.get("datePublished")
                    or ""
                ).strip()
            )
            summary = _workable_text(
                job.get("description")
                or job.get("descriptionHtml")
                or job.get("description_html")
                or job.get("job")
                or job.get("content")
            )

            jobs.append(
                {
                    "title": title,
                    "company": str(job.get("company") or job.get("companyName") or company_name),
                    "location": location,
                    "link": link,
                    "posted_text": "",
                    "posted_date": posted_date,
                    "summary": trim_summary(summary),
                    "source": "Workable",
                    "job_status": status,
                    "ats_account": account,
                }
            )
    return jobs


def smartrecruiters_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for company in SMARTRECRUITERS_COMPANIES:
        offset = 0
        limit = 100
        while True:
            url = f"https://api.smartrecruiters.com/v1/companies/{company}/postings"
            params = {"limit": limit, "offset": offset, "q": "product"}
            try:
                resp = session.get(url, params=params, timeout=20)
            except requests.RequestException:
                break
            if resp.status_code != 200:
                break
            try:
                data = resp.json()
            except ValueError:
                break
            content = data.get("content", [])
            if not content:
                break

            for job in content:
                title = job.get("name", "")
                if not title:
                    continue
                company_name = (job.get("company") or {}).get("name", "") or company.replace("-", " ").title()
                company_identifier = (job.get("company") or {}).get("identifier", "") or company
                location_data = job.get("location") or {}
                location_text = ""
                if location_data.get("remote"):
                    location_text = "Remote"
                else:
                    parts = [
                        location_data.get("city"),
                        location_data.get("region"),
                        location_data.get("country"),
                    ]
                    location_text = ", ".join([p for p in parts if p])
                posted_date = job.get("releasedDate", "")
                posting_id = job.get("id", "")
                link = ""
                if posting_id:
                    link = f"https://jobs.smartrecruiters.com/{company_identifier}/{posting_id}"
                jobs.append(
                    {
                        "title": title,
                        "company": company_name,
                        "location": location_text,
                        "link": link,
                        "posted_text": "",
                        "posted_date": posted_date,
                        "ats_account": company,
                    }
                )

            total_found = data.get("totalFound")
            if not isinstance(total_found, int):
                break
            offset += limit
            if offset >= total_found:
                break
            time.sleep(0.2)
    return jobs


def parse_entry_date(entry: Dict[str, str]) -> str:
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        return dt.isoformat()
    if hasattr(entry, "updated_parsed") and entry.updated_parsed:
        dt = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
        return dt.isoformat()
    if isinstance(entry, dict):
        for key in ("published", "pubDate", "updated", "date", "published_at"):
            raw = entry.get(key)
            if not raw:
                continue
            try:
                dt = parsedate_to_datetime(raw)
            except (TypeError, ValueError):
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            return dt.isoformat()
    return ""


def parse_rss_fallback(text: str) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return entries

    def find_text(node: ET.Element, tags: List[str]) -> str:
        for tag in tags:
            found = node.find(tag)
            if found is not None and found.text:
                return found.text.strip()
        return ""

    for item in root.findall(".//item"):
        title = find_text(item, ["title"])
        link = find_text(item, ["link"])
        summary = find_text(item, ["description", "summary"])
        published = find_text(item, ["pubDate", "published", "updated"])
        entries.append(
            {
                "title": title,
                "link": link,
                "summary": summary,
                "published": published,
            }
        )

    if entries:
        return entries

    atom_ns = "{http://www.w3.org/2005/Atom}"
    for entry in root.findall(f".//{atom_ns}entry") + root.findall(".//entry"):
        title = find_text(entry, [f"{atom_ns}title", "title"])
        summary = find_text(entry, [f"{atom_ns}summary", "summary", f"{atom_ns}content", "content"])
        published = find_text(entry, [f"{atom_ns}updated", "updated", f"{atom_ns}published", "published"])
        link = ""
        for link_el in entry.findall(f"{atom_ns}link") + entry.findall("link"):
            href = link_el.attrib.get("href")
            if href:
                link = href
                break
            if link_el.text:
                link = link_el.text.strip()
                break
        entries.append(
            {
                "title": title,
                "link": link,
                "summary": summary,
                "published": published,
            }
        )
    return entries


def fetch_rss_entries(session: requests.Session, url: str) -> List[Dict[str, str]]:
    try:
        resp = session.get(url, timeout=30)
    except requests.RequestException:
        return []
    if resp.status_code != 200:
        return []
    text = resp.text
    entries: List[Dict[str, str]] = []
    if feedparser is not None:
        feed = feedparser.parse(text)
        entries = list(feed.entries)
    if not entries:
        entries = parse_rss_fallback(text)
    return entries


def rss_search(session: requests.Session, url: str, source_name: str) -> List[Dict[str, str]]:
    entries = fetch_rss_entries(session, url)
    jobs: List[Dict[str, str]] = []
    for entry in entries:
        title = entry.get("title", "") if isinstance(entry, dict) else ""
        if not title:
            continue
        link = entry.get("link", "") if isinstance(entry, dict) else ""
        summary = ""
        if isinstance(entry, dict) and entry.get("summary"):
            summary = trim_summary(entry.get("summary", ""))
        posted_date = parse_entry_date(entry)

        company = entry.get("author", "") if isinstance(entry, dict) else ""
        if " at " in title.lower() and not company:
            parts = title.split(" at ")
            if len(parts) == 2:
                title, company = parts[0].strip(), parts[1].strip()

        jobs.append(
            {
                "title": title,
                "company": company or source_name,
                "location": "Remote",
                "link": clean_link(link),
                "posted_text": "",
                "posted_date": posted_date,
                "summary": summary,
                "source": source_name,
            }
        )
    return jobs


def remotive_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    url = JOB_BOARD_URLS.get("Remotive")
    if not url:
        return jobs
    try:
        resp = session.get(url, timeout=25)
    except requests.RequestException:
        return jobs
    if resp.status_code != 200:
        return jobs
    try:
        data = resp.json()
    except ValueError:
        return jobs
    for job in data.get("jobs", []):
        title = job.get("title", "")
        if not title:
            continue
        jobs.append(
            {
                "title": title,
                "company": job.get("company_name", ""),
                "location": job.get("candidate_required_location", "Remote"),
                "link": job.get("url", ""),
                "posted_text": "",
                "posted_date": job.get("publication_date", ""),
                "summary": trim_summary(job.get("description", "")),
                "source": "Remotive",
            }
        )
    return jobs


def remoteok_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    url = JOB_BOARD_URLS.get("RemoteOK")
    if not url:
        return jobs
    try:
        resp = session.get(url, timeout=25)
    except requests.RequestException:
        return jobs
    if resp.status_code != 200:
        return jobs
    try:
        data = resp.json()
    except ValueError:
        return jobs
    if not isinstance(data, list):
        return jobs
    for job in data:
        title = job.get("position", "")
        if not title:
            continue
        jobs.append(
            {
                "title": title,
                "company": job.get("company", ""),
                "location": job.get("location", "Remote"),
                "link": job.get("url", ""),
                "posted_text": "",
                "posted_date": job.get("date", ""),
                "summary": trim_summary(job.get("description", "")),
                "source": "RemoteOK",
            }
        )
    return jobs


def jobicy_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    url = JOB_BOARD_URLS.get("Jobicy")
    if not url:
        return jobs
    params = {"tag": "product", "geo": "uk"}
    try:
        resp = session.get(url, params=params, timeout=25)
    except requests.RequestException:
        return jobs
    if resp.status_code != 200:
        return jobs
    try:
        data = resp.json()
    except ValueError:
        return jobs
    job_list = data.get("jobs") or data.get("data") or []
    for job in job_list:
        title = job.get("jobTitle") or job.get("title") or ""
        if not title:
            continue
        jobs.append(
            {
                "title": title,
                "company": job.get("companyName", "") or job.get("company", ""),
                "location": job.get("jobGeo", "") or job.get("location", "Remote"),
                "link": job.get("url", "") or job.get("jobUrl", ""),
                "posted_text": "",
                "posted_date": job.get("pubDate", "") or job.get("postedDate", ""),
                "summary": trim_summary(job.get("description", "")),
                "source": "Jobicy",
            }
        )
    return jobs


def meetfrank_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    url = JOB_BOARD_URLS.get("MeetFrank")
    if not url:
        return jobs

    for keyword in BOARD_KEYWORDS[:3]:
        params = {
            "q": keyword,
            "country": "United Kingdom",
            "location": "London",
            "pageSize": 100,
            "language": "en",
        }
        try:
            resp = session.get(url, params=params, timeout=25)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for job in data.get("jobs", []):
            title = job.get("title", "")
            if not title:
                continue
            jobs.append(
                {
                    "title": title,
                    "company": job.get("company", ""),
                    "location": job.get("location", ""),
                    "link": job.get("applyUrl", "") or job.get("url", ""),
                    "posted_text": "",
                    "posted_date": job.get("publishedAt", ""),
                    "summary": trim_summary(job.get("description") or ""),
                    "source": "MeetFrank",
                }
            )
        time.sleep(0.2)
    return jobs


def adzuna_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    if not (ADZUNA_APP_ID and ADZUNA_APP_KEY):
        return jobs
    url = JOB_BOARD_URLS.get("Adzuna")
    if not url:
        return jobs

    for keyword in BOARD_KEYWORDS[:3]:
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "what": keyword,
            "where": "London",
            "results_per_page": 50,
            "sort_by": "date",
            "content-type": "application/json",
        }
        try:
            resp = session.get(url, params=params, timeout=25)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for job in data.get("results", []):
            title = job.get("title", "")
            if not title:
                continue
            company = (job.get("company") or {}).get("display_name", "")
            location = (job.get("location") or {}).get("display_name", "")
            jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": location,
                    "link": job.get("redirect_url", ""),
                    "posted_text": "",
                    "posted_date": job.get("created", ""),
                    "summary": trim_summary(job.get("description") or ""),
                    "source": "Adzuna",
                    "salary_min": int(job.get("salary_min") or 0),
                    "salary_max": int(job.get("salary_max") or 0),
                }
            )
        time.sleep(0.2)
    return jobs


def jooble_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    if not JOOBLE_API_KEY:
        return jobs
    base_url = JOB_BOARD_URLS.get("Jooble")
    if not base_url:
        return jobs
    url = f"{base_url.rstrip('/')}/{JOOBLE_API_KEY}"

    for keyword in BOARD_KEYWORDS[:3]:
        payload = {
            "keywords": keyword,
            "location": "London",
            "page": 1,
            "radius": 20,
        }
        try:
            resp = session.post(url, json=payload, timeout=25)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for job in data.get("jobs", []) or []:
            title = job.get("title", "")
            if not title:
                continue
            jobs.append(
                {
                    "title": title,
                    "company": job.get("company", ""),
                    "location": job.get("location", ""),
                    "link": job.get("link", "") or job.get("url", ""),
                    "posted_text": "",
                    "posted_date": job.get("updated", "") or job.get("date", ""),
                    "summary": trim_summary(job.get("snippet") or job.get("description") or ""),
                    "source": "Jooble",
                }
            )
        time.sleep(0.2)
    return jobs


def reed_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    if not REED_API_KEY:
        return jobs
    url = JOB_BOARD_URLS.get("Reed")
    if not url:
        return jobs

    for keyword in BOARD_KEYWORDS[:3]:
        params = {
            "keywords": keyword,
            "locationName": "London",
            "distanceFromLocation": 25,
            "resultsToTake": 50,
            "resultsToSkip": 0,
        }
        try:
            resp = session.get(url, params=params, auth=(REED_API_KEY, ""), timeout=25)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for job in data.get("results", []) or []:
            title = job.get("jobTitle") or job.get("job_title") or job.get("title") or ""
            if not title:
                continue
            jobs.append(
                {
                    "title": title,
                    "company": job.get("employerName", ""),
                    "location": job.get("locationName", ""),
                    "link": job.get("jobUrl", ""),
                    "posted_text": "",
                    "posted_date": job.get("date", ""),
                    "summary": trim_summary(job.get("jobDescription") or ""),
                    "source": "Reed",
                    "salary_min": int(job.get("minimumSalary") or 0),
                    "salary_max": int(job.get("maximumSalary") or 0),
                }
            )
        time.sleep(0.2)
    return jobs


def cvlibrary_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    if not CV_LIBRARY_API_KEY:
        return jobs
    url = JOB_BOARD_URLS.get("CVLibrary")
    if not url:
        return jobs

    for keyword in BOARD_KEYWORDS[:3]:
        params = {
            "key": CV_LIBRARY_API_KEY,
            "q": keyword,
            "geo": "London",
            "distance": 20,
            "tempperm": "Permanent",
            "perpage": 50,
            "orderby": "date",
        }
        try:
            resp = session.get(url, params=params, timeout=25)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for job in data.get("jobs", []) or data.get("results", []) or []:
            title = job.get("title") or job.get("job_title") or ""
            if not title:
                continue
            cv_sal_min = int(job.get("salary_min") or 0)
            cv_sal_max = int(job.get("salary_max") or 0)
            if not cv_sal_min and not cv_sal_max:
                sal_str = str(job.get("salary") or "")
                sal_str = re.sub(r"(\d+)[kK]", lambda m: str(int(m.group(1)) * 1000), sal_str)
                sal_nums = re.findall(r"\d+", sal_str.replace(",", ""))
                if len(sal_nums) >= 2:
                    cv_sal_min = int(sal_nums[0])
                    cv_sal_max = int(sal_nums[1])
                elif len(sal_nums) == 1:
                    cv_sal_max = int(sal_nums[0])
            jobs.append(
                {
                    "title": title,
                    "company": job.get("company") or job.get("company_name") or "",
                    "location": job.get("location") or job.get("geo") or "",
                    "link": job.get("job_url") or job.get("joburl") or job.get("url") or "",
                    "posted_text": "",
                    "posted_date": job.get("date") or job.get("posted") or job.get("date_posted") or "",
                    "summary": trim_summary(job.get("description") or job.get("short_description") or ""),
                    "source": "CVLibrary",
                    "salary_min": cv_sal_min,
                    "salary_max": cv_sal_max,
                }
            )
        time.sleep(0.2)
    return jobs


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", text.lower())
    return cleaned.strip("-")


def extract_job_links(html: str, base_url: str) -> List[Tuple[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    links: List[Tuple[str, str]] = []
    seen: set[str] = set()
    job_path_pattern = re.compile(r"/job/|/jobs/|jobid=|vacanc|opening|opportunit|position", re.IGNORECASE)
    generic_title_pattern = re.compile(
        r"job openings at|job opportunities at|search\s*&\s*apply|careers?$|campus events|all jobs|open roles|join our team|join us",
        re.IGNORECASE,
    )

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        title = normalize_text(
            anchor.get_text(" ")
            or anchor.get("aria-label", "")
            or anchor.get("title", "")
        )
        haystack = f"{href} {title}"
        if not job_path_pattern.search(haystack):
            continue
        if href.startswith("/"):
            href = urljoin(base_url, href)
        href = clean_link(href)
        if not href or href in seen:
            continue
        if len(title) < 4:
            continue
        if generic_title_pattern.search(title):
            continue
        seen.add(href)
        links.append((href, title))
    return links


def iter_jobposting_nodes(data: object) -> Iterable[Dict[str, object]]:
    if isinstance(data, dict):
        types = data.get("@type")
        if types:
            if isinstance(types, list) and "JobPosting" in types:
                yield data
            if isinstance(types, str) and types == "JobPosting":
                yield data
        if "@graph" in data:
            yield from iter_jobposting_nodes(data.get("@graph"))
        for value in data.values():
            yield from iter_jobposting_nodes(value)
    elif isinstance(data, list):
        for item in data:
            yield from iter_jobposting_nodes(item)


def extract_jobpostings_from_jsonld(html: str, base_url: str, default_company: str = "") -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    jobs: List[Dict[str, str]] = []
    seen: set[str] = set()
    scripts = soup.find_all("script", type="application/ld+json")
    for script in scripts:
        payload_text = script.string or script.get_text()
        if not payload_text:
            continue
        try:
            payload = json.loads(payload_text.strip())
        except ValueError:
            continue
        for node in iter_jobposting_nodes(payload):
            url_value = node.get("url")
            title = node.get("title") if isinstance(node.get("title"), str) else ""
            if not isinstance(url_value, str) or not title:
                continue
            link = clean_link(urljoin(base_url, url_value))
            if not link or link in seen:
                continue
            company = default_company
            hiring_org = node.get("hiringOrganization")
            if isinstance(hiring_org, dict) and isinstance(hiring_org.get("name"), str):
                company = hiring_org.get("name") or default_company
            location = ""
            job_location = node.get("jobLocation")
            if isinstance(job_location, list) and job_location:
                job_location = job_location[0]
            if isinstance(job_location, dict):
                address = job_location.get("address")
                if isinstance(address, dict):
                    location = ", ".join(
                        part
                        for part in [
                            address.get("addressLocality"),
                            address.get("addressRegion"),
                            address.get("addressCountry"),
                        ]
                        if part
                    )
            jobs.append(
                {
                    "title": normalize_text(title),
                    "company": normalize_text(company or default_company),
                    "location": normalize_text(location),
                    "link": link,
                    "posted_text": "",
                    "posted_date": node.get("datePosted") if isinstance(node.get("datePosted"), str) else "",
                    "summary": trim_summary(node.get("description") if isinstance(node.get("description"), str) else ""),
                    "source": "CustomCareers",
                }
            )
            seen.add(link)
    return jobs


def parse_job_detail_jsonld(html: str, fallback_title: str = "") -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script", type="application/ld+json")
    for script in scripts:
        if not script.string:
            continue
        try:
            payload = json.loads(script.string.strip())
        except ValueError:
            continue
        for node in iter_jobposting_nodes(payload):
            title = node.get("title") if isinstance(node.get("title"), str) else ""
            company = ""
            hiring_org = node.get("hiringOrganization")
            if isinstance(hiring_org, dict):
                company = hiring_org.get("name") or ""
            location = ""
            job_location = node.get("jobLocation")
            if isinstance(job_location, list) and job_location:
                job_location = job_location[0]
            if isinstance(job_location, dict):
                address = job_location.get("address")
                if isinstance(address, dict):
                    location = ", ".join(
                        part
                        for part in [
                            address.get("addressLocality"),
                            address.get("addressRegion"),
                            address.get("addressCountry"),
                        ]
                        if part
                    )
            posted_date = node.get("datePosted") if isinstance(node.get("datePosted"), str) else ""
            description = node.get("description") if isinstance(node.get("description"), str) else ""
            return {
                "title": title or fallback_title,
                "company": company,
                "location": location,
                "posted_date": posted_date,
                "summary": trim_summary(description),
            }
    return {}


def parse_job_detail_fallback(html: str) -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    h1 = soup.find("h1")
    if h1:
        title = normalize_text(h1.get_text(" "))
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title.get("content", "")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()

    company = ""
    og_site = soup.find("meta", property="og:site_name")
    if og_site and og_site.get("content"):
        company = og_site.get("content", "")

    description = ""
    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        description = og_desc.get("content", "")
    if not description:
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            description = meta_desc.get("content", "")

    text_blob = normalize_text(soup.get_text(" "))
    posted_text = extract_relative_posted_text(text_blob)
    location = ""
    location_patterns = [
        r"\b([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*,\s*United Kingdom)\b",
        r"\b(Remote\s*\(UK\)|Remote UK|London,\s*England,\s*United Kingdom|London,\s*United Kingdom)\b",
    ]
    for pattern in location_patterns:
        match = re.search(pattern, text_blob)
        if match:
            location = normalize_text(match.group(1))
            break

    return {
        "title": title,
        "company": company,
        "location": location,
        "posted_date": "",
        "posted_text": posted_text,
        "summary": trim_summary(description),
    }


def fetch_manual_link_requests(client: "firestore.Client") -> List[Dict[str, str]]:
    requests: List[Dict[str, str]] = []
    if client is None:
        return requests
    try:
        docs = (
            client.collection(RUN_REQUESTS_COLLECTION)
            .where(filter=FieldFilter("type", "==", "manual_link"))
            .where(filter=FieldFilter("status", "==", "pending"))
            .limit(MANUAL_LINK_LIMIT)
            .stream()
        )
        for doc_snap in docs:
            data = doc_snap.to_dict() or {}
            link = data.get("link") or ""
            if not link:
                continue
            requests.append({"id": doc_snap.id, "link": link})
    except Exception:
        return requests
    return requests


def build_manual_record(session: requests.Session, link: str) -> Optional[JobRecord]:
    try:
        resp = session.get(link, timeout=30)
    except Exception:
        return None
    if resp.status_code != 200:
        return None

    details = parse_job_detail_jsonld(resp.text)
    if not details:
        details = parse_job_detail_fallback(resp.text)

    title = details.get("title") or ""
    company = details.get("company") or ""
    location = details.get("location") or ""
    posted_date = details.get("posted_date") or ""
    posted_text = details.get("posted_text") or ""
    summary = details.get("summary") or ""
    if not title:
        return None

    full_text = f"{title} {company} {summary}"
    fit = assess_fit(full_text, company, "Manual", "Manual")
    score = int(fit["score"])
    why_fit = build_reasons(full_text)
    cv_gap = build_gaps(full_text)
    preference_match = build_preference_match(full_text, company, location)
    posted_value, posted_raw, normalized_posted_date = canonicalize_posted_fields(posted_text, posted_date)

    return JobRecord(
        role=title,
        company=company or "Manual link",
        location=location or "Unknown",
        link=link,
        posted=posted_value,
        posted_raw=posted_raw,
        posted_date=normalized_posted_date,
        source="Manual",
        fit_score=score,
        fit_verdict=str(fit["fit_verdict"]),
        preference_match=preference_match,
        why_fit=why_fit,
        cv_gap=cv_gap,
        notes=summary or full_text[:500],
        source_family="Manual",
    )


def parse_workday_entry(entry: str) -> Tuple[str, str, str, str]:
    entry = entry.strip()
    name = ""
    url = entry
    if "|" in entry:
        name, url = [part.strip() for part in entry.split("|", 1)]
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc
    path = parsed.path.strip("/")
    segments = [seg for seg in path.split("/") if seg]
    filtered = [seg for seg in segments if not re.match(r"^[a-z]{2}-[A-Z]{2}$", seg)]
    site = filtered[-1] if filtered else (segments[-1] if segments else "")
    tenant = host.split(".")[0] if host else ""
    scheme = parsed.scheme or "https"
    if not name:
        name = tenant.replace("-", " ").title() if tenant else "Workday"
    return scheme, host, tenant, site, name


def workday_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    if not WORKDAY_SITES:
        return jobs
    for entry in WORKDAY_SITES:
        scheme, host, tenant, site, company_name = parse_workday_entry(entry)
        if not host or not tenant or not site:
            continue
        api_url = f"{scheme}://{host}/wday/cxs/{tenant}/{site}/jobs"
        for keyword in BROAD_BOARD_KEYWORDS[:3]:
            payload = {
                "limit": 20,
                "offset": 0,
                "searchText": f"{keyword}",
            }
            try:
                resp = session.post(api_url, json=payload, timeout=30)
            except requests.RequestException:
                continue
            if resp.status_code != 200:
                continue
            try:
                data = resp.json()
            except ValueError:
                continue
            postings = data.get("jobPostings") or data.get("jobs") or []
            for posting in postings:
                if not isinstance(posting, dict):
                    continue
                title = posting.get("title") or posting.get("jobTitle") or ""
                if not title:
                    continue
                link = posting.get("externalPath") or posting.get("applyUrl") or ""
                if link and link.startswith("/"):
                    link = f"{scheme}://{host}{link}"
                link = clean_link(link)
                location = posting.get("locationsText") or posting.get("location") or "United Kingdom"
                posted_date = posting.get("postedOn") or ""
                summary = posting.get("description") or ""
                if not summary and isinstance(posting.get("bulletFields"), list):
                    for field in posting.get("bulletFields"):
                        if isinstance(field, dict) and field.get("name") == "jobDescription":
                            summary = field.get("value") or ""
                jobs.append(
                    {
                        "title": normalize_text(title),
                        "company": company_name,
                        "location": normalize_text(location),
                        "link": link,
                        "posted_text": "",
                        "posted_date": posted_date,
                        "summary": trim_summary(summary),
                        "source": "Workday",
                    }
                )
            time.sleep(0.2)
    return jobs


def html_board_search(
    session: requests.Session,
    source_name: str,
    base_url: str,
    keyword_limit: int = 3,
    max_details: int = 12,
) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    job_map: Dict[str, Dict[str, str]] = {}

    for keyword in BOARD_KEYWORDS[:keyword_limit]:
        slug = slugify(keyword)
        search_url = f"{base_url}/jobs/{slug}/in-london"
        generic_title_variants = {
            normalize_text(keyword).lower(),
            normalize_text(keyword.replace("-", " ")).lower(),
            normalize_text(slug.replace("-", " ")).lower(),
        }
        try:
            resp = session.get(search_url, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        links = extract_job_links(resp.text, base_url)
        for link, title in links:
            if link in job_map:
                continue
            normalized_link = clean_link(link)
            parsed_link = urlparse(normalized_link)
            normalized_title = normalize_text(title).lower()
            if normalized_link.rstrip("/") == search_url.rstrip("/"):
                continue
            if parsed_link.path.rstrip("/").lower() == f"/jobs/{slug}/in-london":
                continue
            if parsed_link.path.rstrip("/").lower() == f"/jobs/{slug}":
                continue
            if normalized_title in generic_title_variants:
                continue
            if re.search(r"/jobs/[^/]+/in-[^/]+/?$", parsed_link.path, re.IGNORECASE):
                continue
            job_map[link] = {
                "title": title,
                "company": source_name,
                "location": "London",
                "link": link,
                "posted_text": "",
                "posted_date": "",
                "summary": "",
                "source": source_name,
                "_search_slug": slug,
                "_generic_titles": list(generic_title_variants),
            }

    detail_links = list(job_map.keys())[:max_details]
    for link in detail_links:
        try:
            resp = session.get(link, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        details = parse_job_detail_jsonld(resp.text, job_map[link]["title"])
        if details:
            job_map[link]["title"] = details.get("title") or job_map[link]["title"]
            job_map[link]["company"] = details.get("company") or job_map[link]["company"]
            job_map[link]["location"] = details.get("location") or job_map[link]["location"]
            job_map[link]["posted_date"] = details.get("posted_date") or job_map[link]["posted_date"]
            if details.get("summary"):
                job_map[link]["summary"] = details["summary"]
        parsed_link = urlparse(link)
        title_lower = normalize_text(job_map[link]["title"]).lower()
        generic_titles = set(job_map[link].get("_generic_titles", []) or [])
        search_slug = job_map[link].get("_search_slug", "")
        if title_lower in generic_titles or re.search(r"/jobs/[^/]+/in-[^/]+/?$", parsed_link.path, re.IGNORECASE):
            job_map.pop(link, None)
            continue
        if search_slug and parsed_link.path.rstrip("/").lower() in {f"/jobs/{search_slug}/in-london", f"/jobs/{search_slug}"}:
            job_map.pop(link, None)
            continue
        if not job_map[link]["posted_text"] and not job_map[link]["posted_date"]:
            posted_text = extract_relative_posted_text(resp.text)
            if posted_text:
                job_map[link]["posted_text"] = posted_text
        time.sleep(0.2)

    for payload in job_map.values():
        payload.pop("_search_slug", None)
        payload.pop("_generic_titles", None)
    jobs.extend(job_map.values())
    return jobs


def iter_job_like_nodes(data: object) -> Iterable[Dict[str, object]]:
    if isinstance(data, dict):
        keys = data.keys()
        if "title" in keys and ("company" in keys or "companyName" in keys or "company_name" in keys):
            yield data
        for value in data.values():
            yield from iter_job_like_nodes(value)
    elif isinstance(data, list):
        for item in data:
            yield from iter_job_like_nodes(item)


def efinancialcareers_api_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    api_url = "https://job-search-ui.efinancialcareers.com/v1/efc/jobs/search"
    for keyword in BOARD_KEYWORDS[:3]:
        payload = {
            "keyword": keyword,
            "location": "London",
            "results_wanted": 50,
            "sort": "date",
            "offset": 0,
        }
        try:
            resp = session.post(api_url, json=payload, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        for node in iter_job_like_nodes(data):
            title = node.get("title") if isinstance(node.get("title"), str) else ""
            if not title:
                continue
            company = ""
            for key in ("companyName", "company_name", "company"):
                if isinstance(node.get(key), str):
                    company = node.get(key) or company
            link = ""
            for key in ("jobUrl", "url", "applyUrl", "job_url"):
                if isinstance(node.get(key), str):
                    link = node.get(key) or link
            link = clean_link(link)
            posted_date = ""
            for key in ("datePosted", "date_posted", "created", "postedDate"):
                if isinstance(node.get(key), str):
                    posted_date = node.get(key) or posted_date
            summary = ""
            for key in ("description", "jobDescription", "summary"):
                if isinstance(node.get(key), str):
                    summary = trim_summary(node.get(key))
            location = ""
            for key in ("location", "jobLocation", "city"):
                if isinstance(node.get(key), str):
                    location = node.get(key) or location

            jobs.append(
                {
                    "title": title,
                    "company": company or "eFinancialCareers",
                    "location": location or "United Kingdom",
                    "link": link,
                    "posted_text": "",
                    "posted_date": posted_date,
                    "summary": summary,
                    "source": "eFinancialCareers",
                }
            )
        time.sleep(0.2)
    return jobs


def efinancialcareers_html_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    base_url = JOB_BOARD_URLS.get("eFinancialCareers")
    if not base_url:
        return jobs

    job_map: Dict[str, Dict[str, str]] = {}
    for keyword in BOARD_KEYWORDS[:3]:
        slug = slugify(keyword)
        search_url = f"{base_url}/jobs/{slug}"
        try:
            resp = session.get(search_url, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if "jobs-" not in href or ".id" not in href:
                continue
            if href.startswith("/"):
                href = urljoin(base_url, href)
            href = clean_link(href)
            if not href or href in job_map:
                continue
            title = normalize_text(anchor.get_text(" "))
            if len(title) < 4:
                continue
            job_map[href] = {
                "title": title,
                "company": "eFinancialCareers",
                "location": "United Kingdom",
                "link": href,
                "posted_text": "",
                "posted_date": "",
                "summary": "",
                "source": "eFinancialCareers",
            }
        time.sleep(0.2)

    detail_links = list(job_map.keys())[:10]
    for link in detail_links:
        try:
            resp = session.get(link, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        details = parse_job_detail_jsonld(resp.text, job_map[link]["title"])
        if details:
            job_map[link]["title"] = details.get("title") or job_map[link]["title"]
            job_map[link]["company"] = details.get("company") or job_map[link]["company"]
            job_map[link]["location"] = details.get("location") or job_map[link]["location"]
            job_map[link]["posted_date"] = details.get("posted_date") or job_map[link]["posted_date"]
            if details.get("summary"):
                job_map[link]["summary"] = details["summary"]
        time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def efinancialcareers_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs = efinancialcareers_api_search(session)
    if jobs:
        return jobs
    return efinancialcareers_html_search(session)


def technojobs_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    base_url = JOB_BOARD_URLS.get("Technojobs")
    if not base_url:
        return jobs
    base_urls = [base_url]
    if base_url.startswith("https://www."):
        base_urls.append(base_url.replace("https://www.", "https://"))

    job_map: Dict[str, Dict[str, str]] = {}
    for keyword in BROAD_BOARD_KEYWORDS[:3]:
        slug = slugify(keyword)
        for current_base in base_urls:
            search_urls = [
                f"{current_base}/{slug}-jobs/london",
                f"{current_base}/{slug}-jobs",
            ]
            for search_url in search_urls:
                try:
                    resp = session.get(search_url, timeout=8)
                except requests.exceptions.SSLError:
                    try:
                        import urllib3
                        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                        resp = session.get(search_url, timeout=8, verify=False)
                    except requests.RequestException:
                        continue
                except requests.RequestException:
                    continue
                if resp.status_code != 200:
                    continue

                soup = BeautifulSoup(resp.text, "html.parser")
                candidates: List[str] = []
                for anchor in soup.find_all("a", href=True):
                    href = anchor.get("href", "")
                    if "jobid=" not in href and "/job/" not in href and "job" not in href:
                        continue
                    candidates.append(href)

                for href in candidates:
                    link = urljoin(current_base, href) if href.startswith("/") else href
                    link = clean_link(link)
                    if not link or link in job_map:
                        continue
                    title = ""
                    anchor = soup.find("a", href=href)
                    if anchor:
                        title = normalize_text(anchor.get_text(" "))
                    if len(title) < 4:
                        title = "Product role"

                    posted_text = ""
                    if anchor:
                        container = anchor
                        for _ in range(4):
                            if not container:
                                break
                            text_blob = normalize_text(container.get_text(" "))
                            posted_text = extract_relative_posted_text(text_blob)
                            if posted_text:
                                break
                            container = container.parent

                    job_map[link] = {
                        "title": title,
                        "company": "Technojobs",
                        "location": "London",
                        "link": link,
                        "posted_text": posted_text,
                        "posted_date": "",
                        "summary": "",
                        "source": "Technojobs",
                    }
                time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def indeed_search(session: requests.Session) -> List[Dict[str, str]]:
    mode = (os.getenv("JOB_DIGEST_INDEED_MODE", "jobspy") or "jobspy").strip().lower()
    if mode == "jobspy":
        jobs, meta = jobspy_indeed_search()
        mark_source_runtime_event(
            "IndeedUK",
            raw=int(meta.get("raw", 0) or 0),
            failed=int(meta.get("failed", 0) or 0),
            mode="jobspy",
            query_count=int(meta.get("query_count", 0) or 0),
            company_query_count=int(meta.get("company_query_count", 0) or 0),
            adjacent_query_count=int(meta.get("adjacent_query_count", 0) or 0),
            note="Indeed jobspy yielded jobs" if jobs else "Indeed jobspy returned no jobs",
        )
        for note in meta.get("notes", []) or []:
            mark_source_runtime_event("IndeedUK", note=str(note), mode="jobspy")
        return jobs
    if mode == "browser":
        browser_jobs = indeed_browser_search()
        if browser_jobs:
            return browser_jobs
        mark_source_runtime_event("IndeedUK", note="Indeed browser falling back to requests path", mode="browser")
    elif mode == "requests":
        mark_source_runtime_event("IndeedUK", mode="requests")
    jobs: List[Dict[str, str]] = []
    primary_base_url = JOB_BOARD_URLS.get("IndeedUK")
    if not primary_base_url:
        return jobs
    deadline_seconds = int(os.getenv("JOB_DIGEST_INDEED_DEADLINE_SECONDS", "45") or "45")
    started = time.monotonic()

    def deadline_reached() -> bool:
        return deadline_seconds > 0 and (time.monotonic() - started) >= deadline_seconds

    def request_timeout() -> int:
        if deadline_seconds <= 0:
            return 30
        remaining = deadline_seconds - int(time.monotonic() - started)
        return max(5, min(30, remaining))

    base_urls: List[str] = []
    for candidate in (primary_base_url, "https://www.indeed.co.uk"):
        cleaned = candidate.strip().rstrip("/")
        if cleaned and cleaned not in base_urls:
            base_urls.append(cleaned)

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": f"{base_urls[0]}/",
    }

    search_terms: List[str] = []
    for keyword in (
        BOARD_KEYWORDS[:8]
        + BROAD_BOARD_KEYWORDS[:8]
        + [
            "client lifecycle management",
            "lead business analyst",
            "business analyst onboarding",
            "operations strategy",
            "financial crime transformation",
            "senior manager operations strategy",
        ]
    ):
        cleaned = normalize_text(keyword)
        if cleaned and cleaned not in search_terms:
            search_terms.append(cleaned)

    locations = ["London", "United Kingdom", "Remote"]
    company_queries: List[Tuple[str, str]] = []
    for company in select_company_batch(SEARCH_COMPANIES)[:18]:
        for term in ("product manager", "product owner", "business analyst", "operations strategy"):
            company_queries.append((f"\"{company}\" {term}", "United Kingdom"))
            company_queries.append((f"{company} {term}", "London"))

    job_map: Dict[str, Dict[str, str]] = {}

    def add_job(payload: Dict[str, str]) -> None:
        link = clean_link(payload.get("link", ""))
        title = normalize_text(payload.get("title", ""))
        if not link or not title:
            return
        existing = job_map.get(link)
        if not existing:
            payload["link"] = link
            payload["title"] = title
            payload["company"] = normalize_text(payload.get("company", "") or "Indeed")
            payload["location"] = normalize_text(payload.get("location", "") or "United Kingdom")
            payload["summary"] = trim_summary(payload.get("summary", ""))
            payload["source"] = "IndeedUK"
            job_map[link] = payload
            return
        if payload.get("summary") and not existing.get("summary"):
            existing["summary"] = trim_summary(payload.get("summary", ""))
        if payload.get("posted_date") and not existing.get("posted_date"):
            existing["posted_date"] = payload.get("posted_date", "")
        if payload.get("posted_text") and not existing.get("posted_text"):
            existing["posted_text"] = payload.get("posted_text", "")
        if payload.get("company") and existing.get("company") in {"", "Indeed"}:
            existing["company"] = normalize_text(payload.get("company", ""))
        if payload.get("location") and existing.get("location") in {"", "United Kingdom"}:
            existing["location"] = normalize_text(payload.get("location", ""))

    for base_url in base_urls:
        if deadline_reached():
            mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed RSS pass timed out")
            return list(job_map.values())
        headers["Referer"] = f"{base_url}/"
        for keyword in search_terms[:12]:
            if deadline_reached():
                mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed RSS pass timed out")
                return list(job_map.values())
            for location in locations:
                rss_urls = [
                    f"{base_url}/jobs?rss=1&q={quote_plus(keyword)}&l={quote_plus(location)}&sort=date&fromage=7",
                    f"{base_url}/rss?q={quote_plus(keyword)}&l={quote_plus(location)}&sort=date&fromage=7",
                ]
                for rss_url in rss_urls:
                    entries = fetch_rss_entries(session, rss_url)
                    if not entries and feedparser is not None:
                        try:
                            feed = feedparser.parse(rss_url)
                            entries = list(feed.entries)
                        except Exception:
                            entries = []
                    for entry in entries:
                        if isinstance(entry, dict):
                            title = entry.get("title", "")
                            link = entry.get("link", "")
                            summary = trim_summary(entry.get("summary", "")) if entry.get("summary") else ""
                            company = entry.get("author", "") or "Indeed"
                        else:
                            title = ""
                            link = ""
                            summary = ""
                            company = "Indeed"
                        if not title:
                            continue
                        add_job(
                            {
                                "title": title,
                                "company": company,
                                "location": location,
                                "link": link,
                                "posted_text": "",
                                "posted_date": parse_entry_date(entry),
                                "summary": summary,
                                "source": "IndeedUK",
                            }
                        )
                    if entries:
                        break
                if deadline_reached():
                    mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed RSS pass timed out")
                    return list(job_map.values())
                time.sleep(0.15)

    for base_url in base_urls:
        if deadline_reached():
            mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed company-query pass timed out")
            return list(job_map.values())
        headers["Referer"] = f"{base_url}/"
        for query, location in company_queries:
            if deadline_reached():
                mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed company-query pass timed out")
                return list(job_map.values())
            rss_url = f"{base_url}/jobs?rss=1&q={quote_plus(query)}&l={quote_plus(location)}&sort=date&fromage=14"
            entries = fetch_rss_entries(session, rss_url)
            for entry in entries:
                if isinstance(entry, dict):
                    title = entry.get("title", "")
                    link = entry.get("link", "")
                    summary = trim_summary(entry.get("summary", "")) if entry.get("summary") else ""
                    company = entry.get("author", "") or "Indeed"
                else:
                    title = ""
                    link = ""
                    summary = ""
                    company = "Indeed"
                if not title:
                    continue
                add_job(
                    {
                        "title": title,
                        "company": company,
                        "location": location,
                        "link": link,
                        "posted_text": "",
                        "posted_date": parse_entry_date(entry),
                        "summary": summary,
                        "source": "IndeedUK",
                    }
                )
            time.sleep(0.1)

    if job_map:
        mark_source_runtime_event("IndeedUK", raw=len(job_map), note="Indeed RSS/company query yielded jobs")
        return list(job_map.values())

    for base_url in base_urls:
        if deadline_reached():
            mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed HTML pass timed out")
            return list(job_map.values())
        headers["Referer"] = f"{base_url}/"
        for keyword in search_terms[:6]:
            if deadline_reached():
                mark_source_runtime_event("IndeedUK", timed_out=1, note="Indeed HTML pass timed out")
                return list(job_map.values())
            for location in locations:
                params = {"q": keyword, "l": location, "fromage": 7, "sort": "date"}
                try:
                    resp = session.get(f"{base_url}/jobs", params=params, headers=headers, timeout=request_timeout())
                except requests.RequestException:
                    continue
                if resp.status_code == 403:
                    mark_source_runtime_event("IndeedUK", blocked=1, note=f"Indeed HTML blocked at {base_url}")
                    continue
                if resp.status_code != 200:
                    continue
                if "Security Check - Indeed.com" in resp.text or "Additional Verification Required" in resp.text:
                    mark_source_runtime_event("IndeedUK", blocked=1, note=f"Indeed security check at {base_url}")
                    continue

                soup = BeautifulSoup(resp.text, "html.parser")
                cards = (
                    soup.select("div.job_seen_beacon")
                    or soup.select("a.tapItem")
                    or soup.select("div.cardOutline")
                    or soup.select("td.resultContent")
                    or soup.select("div[data-jk]")
                )
                if cards:
                    for card in cards:
                        anchor = None
                        jk = card.get("data-jk")
                        link = ""
                        if jk:
                            link = f"{base_url}/viewjob?jk={jk}"
                        else:
                            anchor = (
                                card.select_one("a.jcs-JobTitle[href]")
                                or card.select_one("h2.jobTitle a[href]")
                                or card.select_one("a.tapItem[href]")
                                or card.find("a", href=True)
                            )
                            if not anchor:
                                continue
                            href = anchor.get("href", "")
                            if "jk=" not in href and "/rc/clk" not in href and "/viewjob" not in href:
                                continue
                            link = urljoin(base_url, href)
                        link = clean_link(link)
                        if not link or link in job_map:
                            continue
                        title_el = (
                            card.select_one("h2.jobTitle span")
                            or card.select_one("a.jcs-JobTitle span")
                            or card.select_one("a[data-jk]")
                            or anchor
                        )
                        title = normalize_text(title_el.get_text(" ")) if title_el else ""
                        if len(title) < 4:
                            continue
                        company_el = card.select_one("span.companyName")
                        location_el = card.select_one("div.companyLocation")
                        snippet_el = card.select_one("div.job-snippet") or card.select_one("div.heading6")
                        posted_el = (
                            card.select_one("span.date")
                            or card.select_one("span[aria-label]")
                            or card.select_one("div.metadata")
                        )

                        posted_text = ""
                        if posted_el:
                            posted_text = extract_relative_posted_text(posted_el.get_text(" "))
                        if not posted_text:
                            posted_text = extract_relative_posted_text(normalize_text(card.get_text(" ")))

                        add_job(
                            {
                                "title": title,
                                "company": normalize_text(company_el.get_text(" ")) if company_el else "Indeed",
                                "location": normalize_text(location_el.get_text(" ")) if location_el else location,
                                "link": link,
                                "posted_text": posted_text,
                                "posted_date": "",
                                "summary": trim_summary(snippet_el.get_text(" ") if snippet_el else ""),
                                "source": "IndeedUK",
                            }
                        )
                else:
                    for anchor in soup.find_all("a", href=True):
                        href = anchor.get("href", "")
                        if "jk=" not in href:
                            continue
                        if "/rc/clk" not in href and "/viewjob" not in href:
                            continue
                        link = urljoin(base_url, href)
                        link = clean_link(link)
                        if not link or link in job_map:
                            continue
                        title = normalize_text(anchor.get_text(" "))
                        if len(title) < 4:
                            continue
                        add_job(
                            {
                                "title": title,
                                "company": "Indeed",
                                "location": location,
                                "link": link,
                                "posted_text": "",
                                "posted_date": "",
                                "summary": "",
                                "source": "IndeedUK",
                            }
                        )

                time.sleep(0.2)

    jobs.extend(job_map.values())
    mark_source_runtime_event("IndeedUK", raw=len(jobs), note="Indeed completed without yielded jobs" if not jobs else "Indeed HTML yielded jobs")
    return jobs


def indeed_browser_search() -> List[Dict[str, str]]:
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "job_digest" / "indeed_browser.mjs"
    if not script_path.exists():
        return []

    company_limit = int(os.getenv("JOB_DIGEST_INDEED_COMPANY_LIMIT", "10") or "10")
    page_limit = int(os.getenv("JOB_DIGEST_INDEED_PAGE_LIMIT", "1") or "1")
    browser_timeout = int(os.getenv("JOB_DIGEST_INDEED_BROWSER_TIMEOUT_SECONDS", "60") or "60")

    queries: List[Dict[str, str]] = []
    seen_queries = set()
    for company in select_company_batch(SEARCH_COMPANIES)[:company_limit]:
        for term in ("product manager", "product owner", "business analyst"):
            for location in ("United Kingdom", "London"):
                q = f"{company} {term}"
                key = (q.lower(), location.lower())
                if key in seen_queries:
                    continue
                seen_queries.add(key)
                queries.append({"q": q, "l": location})
    for term in (
        "client lifecycle management",
        "lead business analyst",
        "business analyst onboarding",
        "operations strategy",
        "financial crime transformation",
    ):
        key = (term.lower(), "united kingdom")
        if key in seen_queries:
            continue
        seen_queries.add(key)
        queries.append({"q": term, "l": "United Kingdom"})

    payload = {
        "baseUrl": JOB_BOARD_URLS.get("IndeedUK", "https://uk.indeed.com"),
        "queries": queries[: max(8, company_limit * 4)],
        "pageLimit": page_limit,
        "timeoutMs": browser_timeout * 1000,
        "headless": os.getenv("JOB_DIGEST_INDEED_HEADLESS", "true").lower() != "false",
        "proxyUrl": os.getenv("JOB_DIGEST_INDEED_PROXY_URL", "").strip(),
        "userAgent": USER_AGENT,
    }

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(payload, handle)
        input_path = Path(handle.name)

    try:
        result = subprocess.run(
            ["node", str(script_path), str(input_path)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=max(browser_timeout + 20, 45),
            env=os.environ.copy(),
        )
    except Exception:
        mark_source_runtime_event("IndeedUK", failed=1, note="Indeed browser launch failed")
        return []
    finally:
        try:
            input_path.unlink(missing_ok=True)
        except Exception:
            pass

    if result.returncode != 0:
        mark_source_runtime_event("IndeedUK", failed=1, note="Indeed browser command failed")
        return []

    try:
        payload = json.loads(result.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return []

    blocked_pages = int(payload.get("blockedPages", 0) or 0)
    attempted_queries = int(payload.get("attemptedQueries", 0) or 0)
    raw_jobs = len(payload.get("jobs", []))
    if blocked_pages or attempted_queries:
        print(
            f"[IndeedUK browser] attempted_queries={attempted_queries} "
            f"blocked_pages={blocked_pages} raw_jobs={raw_jobs}"
        )
    if blocked_pages:
        mark_source_runtime_event(
            "IndeedUK",
            blocked=blocked_pages,
            raw=raw_jobs,
            note="Indeed browser blocked by anti-bot",
            mode="browser",
            query_count=attempted_queries,
        )
    elif attempted_queries and raw_jobs == 0:
        mark_source_runtime_event("IndeedUK", raw=0, note="Indeed browser returned no jobs", mode="browser", query_count=attempted_queries)

    jobs: List[Dict[str, str]] = []
    seen_links = set()
    for item in payload.get("jobs", []):
        title = normalize_text(item.get("title", ""))
        link = clean_link(item.get("link", ""))
        if not title or not link or link in seen_links:
            continue
        seen_links.add(link)
        jobs.append(
            {
                "title": title,
                "company": normalize_text(item.get("company", "") or "Indeed"),
                "location": normalize_text(item.get("location", "") or "United Kingdom"),
                "link": link,
                "posted_text": normalize_text(item.get("posted_text", "")),
                "posted_date": normalize_text(item.get("posted_date", "")),
                "summary": trim_summary(item.get("summary", "")),
                "source": "IndeedUK",
            }
        )
    if jobs:
        mark_source_runtime_event("IndeedUK", raw=len(jobs), note="Indeed browser yielded jobs", mode="browser", query_count=attempted_queries)
    return jobs


def builtin_london_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    base_url = JOB_BOARD_URLS.get("BuiltInLondon")
    if not base_url:
        return jobs

    job_map: Dict[str, Dict[str, str]] = {}
    search_paths = [
        "/jobs/product/search/product-manager",
        "/jobs/product/search/product-owner",
        "/jobs/product/search/product-lead",
        "/jobs/product/search/product-director",
        "/jobs/product/search/product-operations",
    ]
    for path in search_paths:
        search_url = f"{base_url}{path}"
        try:
            resp = session.get(search_url, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if "/job/" not in href:
                continue
            link = urljoin(base_url, href) if href.startswith("/") else href
            link = clean_link(link)
            if not link or link in job_map:
                continue
            title = normalize_text(anchor.get_text(" "))
            if len(title) < 4:
                continue
            if "image" in title.lower():
                continue

            posted_text = ""
            container = anchor
            for _ in range(4):
                if not container:
                    break
                text_blob = normalize_text(container.get_text(" "))
                posted_text = extract_relative_posted_text(text_blob)
                if posted_text:
                    break
                container = container.parent

            job_map[link] = {
                "title": title,
                "company": "BuiltIn",
                "location": "London",
                "link": link,
                "posted_text": posted_text,
                "posted_date": "",
                "summary": "",
                "source": "BuiltInLondon",
            }
        time.sleep(0.2)

    detail_links = list(job_map.keys())[:15]
    for link in detail_links:
        try:
            resp = session.get(link, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        details = parse_job_detail_jsonld(resp.text, job_map[link]["title"])
        if details:
            job_map[link]["title"] = details.get("title") or job_map[link]["title"]
            job_map[link]["company"] = details.get("company") or job_map[link]["company"]
            job_map[link]["location"] = details.get("location") or job_map[link]["location"]
            job_map[link]["posted_date"] = details.get("posted_date") or job_map[link]["posted_date"]
            if details.get("summary"):
                job_map[link]["summary"] = details["summary"]
        time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def jobserve_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    url = JOB_BOARD_URLS.get("JobServe")
    if not url:
        return jobs
    try:
        resp = session.get(url, timeout=25)
    except requests.RequestException:
        return jobs
    if resp.status_code != 200:
        return jobs

    soup = BeautifulSoup(resp.text, "html.parser")
    form = soup.select_one("form")
    if not form:
        return jobs

    base_payload = {}
    for inp in soup.select("form input"):
        name = inp.get("name")
        if not name:
            continue
        base_payload[name] = inp.get("value", "")

    action = form.get("action", "")
    post_url = urljoin(url, action)

    job_map: Dict[str, Dict[str, str]] = {}
    for keyword in BOARD_KEYWORDS[:3]:
        payload = dict(base_payload)
        payload["ctl00$main$srch$ctl_qs$txtKey"] = keyword
        payload["ctl00$main$srch$ctl_qs$txtTitle"] = ""
        payload["ctl00$main$srch$ctl_qs$txtLoc"] = "London"

        try:
            resp2 = session.post(post_url, data=payload, timeout=30)
        except requests.RequestException:
            continue
        if resp2.status_code != 200:
            continue

        soup2 = BeautifulSoup(resp2.text, "html.parser")
        shid_el = soup2.select_one("#shid")
        job_ids_el = soup2.select_one("#jobIDs")
        if not shid_el or not job_ids_el:
            continue
        shid = shid_el.get("value", "")
        job_ids_str = job_ids_el.get("value", "")
        if not shid or not job_ids_str:
            continue
        first_segment = job_ids_str.split("%")[0]
        if not first_segment:
            continue

        api_url = f"https://jobserve.com/WebServices/JobSearch.asmx/RetrieveJobs?shid={shid}"
        try:
            resp3 = session.post(api_url, json={"jobIDsStr": first_segment, "pageNum": "1"}, timeout=30)
        except requests.RequestException:
            continue
        if resp3.status_code != 200:
            continue
        try:
            data = resp3.json()
        except ValueError:
            continue
        html = data.get("d", "")
        if not html:
            continue

        soup3 = BeautifulSoup(html, "html.parser")
        for item in soup3.select("div.jobItem"):
            job_id = (item.get("id") or "").strip()
            if not job_id:
                continue
            title_el = item.select_one("h3.jobResultsTitle")
            title = normalize_text(title_el.get_text(" ")) if title_el else ""
            if not title:
                continue
            location_el = item.select_one("p.jobResultsLoc")
            location = normalize_text(location_el.get_text(" ")) if location_el else ""
            posted_el = item.select_one("p.when")
            posted_text = normalize_text(posted_el.get_text(" ")) if posted_el else ""
            job_type_el = item.select_one("p.jobResultsType")
            job_type = normalize_text(job_type_el.get_text(" ")) if job_type_el else ""
            salary_el = item.select_one("p.jobResultsSalary")
            salary = normalize_text(salary_el.get_text(" ")) if salary_el else ""

            summary_parts = [part for part in [job_type, salary] if part]
            summary = " · ".join(summary_parts)

            job_map[job_id] = {
                "title": title,
                "company": "JobServe",
                "location": location or "United Kingdom",
                "link": f"https://jobserve.com/gb/en/JobSearch.aspx?jobid={job_id}",
                "posted_text": posted_text,
                "posted_date": "",
                "summary": summary,
                "source": "JobServe",
            }

        time.sleep(0.2)

    # Enrich a few jobs with detail text
    detail_ids = list(job_map.keys())[:6]
    for job_id in detail_ids:
        api_url = "https://jobserve.com/WebServices/JobSearch.asmx/RetrieveSingleJobDetail"
        try:
            resp = session.post(api_url, json={"id": job_id}, timeout=20)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except ValueError:
            continue
        detail_html = (data.get("d") or {}).get("JobDetailHtml", "")
        if not detail_html:
            continue
        detail_text = normalize_text(BeautifulSoup(detail_html, "html.parser").get_text(" "))
        if detail_text:
            job_map[job_id]["summary"] = detail_text[:800]
            if "Posted by:" in detail_text:
                try:
                    company = detail_text.split("Posted by:")[1].split("Posted:", 1)[0].strip()
                    if company:
                        job_map[job_id]["company"] = company
                except Exception:
                    pass

        time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def weloveproduct_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    base_url = JOB_BOARD_URLS.get("WeLoveProduct")
    if not base_url:
        return jobs

    job_map: Dict[str, Dict[str, str]] = {}
    search_paths = [
        "/jobs",
        "/jobs/",
        "/job-board",
        "/jobs?query=product",
        "/jobs?search=product",
        "/jobs?remote=true",
        "/jobs?location=United Kingdom",
    ]

    for path in search_paths:
        search_url = f"{base_url}{path}"
        try:
            resp = session.get(search_url, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        links = extract_job_links(resp.text, base_url)
        for link, title in links:
            if link in job_map:
                continue
            job_map[link] = {
                "title": title,
                "company": "WeLoveProduct",
                "location": "United Kingdom",
                "link": link,
                "posted_text": "",
                "posted_date": "",
                "summary": "",
                "source": "WeLoveProduct",
            }

        time.sleep(0.2)

    detail_links = list(job_map.keys())[:8]
    for link in detail_links:
        try:
            resp = session.get(link, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        details = parse_job_detail_jsonld(resp.text, job_map[link]["title"])
        if details:
            job_map[link]["title"] = details.get("title") or job_map[link]["title"]
            job_map[link]["company"] = details.get("company") or job_map[link]["company"]
            job_map[link]["location"] = details.get("location") or job_map[link]["location"]
            job_map[link]["posted_date"] = details.get("posted_date") or job_map[link]["posted_date"]
            if details.get("summary"):
                job_map[link]["summary"] = details["summary"]
        if not job_map[link]["posted_text"] and not job_map[link]["posted_date"]:
            posted_text = extract_relative_posted_text(resp.text)
            if posted_text:
                job_map[link]["posted_text"] = posted_text
        time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def workinstartups_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    base_url = "https://workinstartups.com"
    headers = {"User-Agent": USER_AGENT}
    job_map: Dict[str, Dict[str, str]] = {}

    search_urls = [f"{base_url}/job-board/jobs-in/london?f=7"]
    for keyword in BOARD_KEYWORDS[:3]:
        slug = slugify(keyword)
        search_urls.append(f"{base_url}/job-board/jobs-in/london/{slug}?f=7")

    for search_url in search_urls:
        try:
            resp = session.get(search_url, headers=headers, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if "/details/" not in href:
                continue
            if href.startswith("/"):
                href = urljoin(base_url, href)
            href = clean_link(href)
            if not href or href in job_map:
                continue
            title = normalize_text(anchor.get_text(" "))
            if len(title) < 4:
                continue

            company = ""
            location = ""
            posted_text = ""
            container = anchor.parent
            for _ in range(4):
                if not container:
                    break
                text_blob = normalize_text(container.get_text(" "))
                if not company:
                    company_el = container.find(
                        "span", class_=re.compile(r"company|employer", re.I)
                    ) or container.find("div", class_=re.compile(r"company|employer", re.I))
                    if company_el:
                        company = normalize_text(company_el.get_text(" "))
                if not location:
                    loc_el = container.find(
                        "span", class_=re.compile(r"location|place", re.I)
                    ) or container.find("div", class_=re.compile(r"location|place", re.I))
                    if loc_el:
                        location = normalize_text(loc_el.get_text(" "))
                if not posted_text:
                    posted_text = extract_relative_posted_text(text_blob)
                container = container.parent

            job_map[href] = {
                "title": title,
                "company": company or "WorkInStartups",
                "location": location or "London",
                "link": href,
                "posted_text": posted_text,
                "posted_date": "",
                "summary": "",
                "source": "WorkInStartups",
            }
        time.sleep(0.3)

    detail_links = list(job_map.keys())[:12]
    for link in detail_links:
        try:
            resp = session.get(link, headers=headers, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code != 200:
            continue
        details = parse_job_detail_jsonld(resp.text, job_map[link]["title"])
        if details:
            job_map[link]["title"] = details.get("title") or job_map[link]["title"]
            job_map[link]["company"] = details.get("company") or job_map[link]["company"]
            job_map[link]["location"] = details.get("location") or job_map[link]["location"]
            job_map[link]["posted_date"] = details.get("posted_date") or job_map[link]["posted_date"]
            if details.get("summary"):
                job_map[link]["summary"] = details["summary"]
        if not job_map[link]["posted_text"] and not job_map[link]["posted_date"]:
            posted_text = extract_relative_posted_text(resp.text)
            if posted_text:
                job_map[link]["posted_text"] = posted_text
        time.sleep(0.2)

    jobs.extend(job_map.values())
    return jobs


def load_custom_careers_targets(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
    except OSError:
        return []
    targets: List[Dict[str, str]] = []
    seen = set()
    health_state = load_custom_careers_health_state()
    include_alternate_targets = os.getenv("JOB_DIGEST_CUSTOM_INCLUDE_ATS_ALTERNATES", "false").lower() == "true"
    try:
        from .company_coverage import read_registry
        registry_rows = read_registry()
    except Exception:
        registry_rows = []
    registry_map = {row.get("firm_name", ""): row for row in registry_rows}
    for row in rows:
        if (row.get("platform") or "").strip().lower() != "custom":
            continue
        careers_url = clean_link((row.get("careers_url") or "").strip())
        if not careers_url:
            continue
        key = ((row.get("firm") or "").strip(), careers_url)
        if key in seen:
            continue
        seen.add(key)
        registry_row = registry_map.get((row.get("firm") or "").strip(), {})
        canonical_platform = (registry_row.get("canonical_platform") or "").strip()
        if canonical_platform and canonical_platform.lower() != "custom" and not include_alternate_targets:
            continue
        targets.append(
            {
                "firm": (row.get("firm") or "").strip(),
                "careers_url": careers_url,
                "source": (row.get("source") or "CustomCareers").strip() or "CustomCareers",
                "priority_tier": registry_row.get("priority_tier", "Tier3"),
                "fit_relevance": registry_row.get("fit_relevance", "Adjacent"),
                "primary_category": registry_row.get("primary_category", ""),
                "canonical_platform": canonical_platform,
                "uk_relevance": registry_row.get("uk_relevance", ""),
                "last_status": str((health_state.get(careers_url, {}) or {}).get("last_status", "")),
                "last_raw": int((health_state.get(careers_url, {}) or {}).get("last_raw", 0) or 0),
                "last_kept": int((health_state.get(careers_url, {}) or {}).get("last_kept", 0) or 0),
                "last_dropped_location": int((((health_state.get(careers_url, {}) or {}).get("dropped", {}) or {}).get("location", 0) or 0)),
                "last_dropped_title": int((((health_state.get(careers_url, {}) or {}).get("dropped", {}) or {}).get("title", 0) or 0)),
            }
        )
    tier_rank = {"Tier1": 0, "Tier2": 1, "Tier3": 2}
    fit_rank = {"Core": 0, "Adjacent": 1, "Low": 2}
    status_rank = {"healthy": 0, "weak_yield": 1, "empty": 2, "timed_out": 3, "broken": 4, "blocked": 5}
    uk_rank = {"UK-HQ": 0, "UK-Presence": 1, "UK-Hiring-Remote": 2}
    targets.sort(
        key=lambda item: (
            tier_rank.get(item["priority_tier"], 9),
            0 if item.get("primary_category") == "Bank" else 1,
            uk_rank.get(item.get("uk_relevance", ""), 3),
            custom_careers_url_penalty(item.get("careers_url", "")),
            status_rank.get(item.get("last_status", ""), 6),
            -int(item.get("last_kept", 0) or 0),
            -int(item.get("last_raw", 0) or 0),
            int(item.get("last_dropped_location", 0) or 0),
            int(item.get("last_dropped_title", 0) or 0),
            fit_rank.get(item["fit_relevance"], 9),
            item["firm"].lower(),
        )
    )

    target_limit = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_TARGET_LIMIT", "36") or "36")
    if target_limit <= 0 or len(targets) <= target_limit:
        return targets

    tier1_targets = [item for item in targets if item["priority_tier"] == "Tier1"]
    remaining = [item for item in targets if item["priority_tier"] != "Tier1"]
    remaining_slots = max(0, target_limit - len(tier1_targets))
    if remaining_slots == 0:
        return tier1_targets[:target_limit]

    rotation_seed = int(time.time() // (8 * 3600))
    offset = rotation_seed % len(remaining) if remaining else 0
    rotated = remaining[offset:] + remaining[:offset]
    return tier1_targets + rotated[:remaining_slots]


def discover_custom_job_hubs(html: str, base_url: str) -> List[str]:
    soup = BeautifulSoup(html, "html.parser")
    discovered: List[str] = []
    seen = set()
    base_netloc = urlparse(base_url).netloc
    for anchor in soup.find_all("a", href=True):
        href = clean_link(urljoin(base_url, anchor.get("href", "")))
        if not href:
            continue
        parsed = urlparse(href)
        if parsed.netloc and parsed.netloc != base_netloc:
            continue
        label = normalize_text(anchor.get_text(" "))
        haystack = f"{href} {label}".lower()
        if not any(token in haystack for token in ("job", "career", "vacanc", "opening", "opportunit")):
            continue
        if href in seen:
            continue
        seen.add(href)
        discovered.append(href)
    return discovered[:6]


def custom_careers_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    targets = load_custom_careers_targets(UK_FEEDS_PATH)
    if not targets:
        return jobs
    deadline_seconds = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_DEADLINE_SECONDS", "60") or "60")
    target_timeout_seconds = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_TARGET_TIMEOUT_SECONDS", "8") or "8")
    max_pages_per_target = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_MAX_PAGES_PER_TARGET", "3") or "3")
    max_detail_links_per_target = int(os.getenv("JOB_DIGEST_CUSTOM_CAREERS_MAX_DETAIL_LINKS_PER_TARGET", "10") or "10")
    started = time.monotonic()

    def deadline_reached() -> bool:
        return deadline_seconds > 0 and (time.monotonic() - started) >= deadline_seconds

    def request_timeout() -> int:
        if deadline_seconds <= 0:
            return 25
        remaining = deadline_seconds - int(time.monotonic() - started)
        return max(5, min(25, remaining))

    for target in targets:
        if deadline_reached():
            mark_source_runtime_event("CustomCareers", timed_out=1, note="custom careers deadline reached")
            return jobs
        target_started = time.monotonic()
        def target_deadline_reached() -> bool:
            if target_timeout_seconds <= 0:
                return False
            return (time.monotonic() - target_started) >= target_timeout_seconds
        careers_url = target["careers_url"]
        target_raw = 0
        try:
            resp = session.get(careers_url, timeout=request_timeout())
        except requests.RequestException:
            mark_source_runtime_event("CustomCareers", failed=1, note=f"request failed for {target['firm']}")
            continue
        if resp.status_code != 200:
            if resp.status_code in {403, 429}:
                mark_source_runtime_event("CustomCareers", blocked=1, note=f"{target['firm']} returned {resp.status_code}")
            else:
                mark_source_runtime_event("CustomCareers", failed=1, note=f"{target['firm']} returned {resp.status_code}")
            continue

        pages_to_visit = [careers_url]
        pages_to_visit.extend(discover_custom_job_hubs(resp.text, careers_url))
        job_map: Dict[str, Dict[str, str]] = {}
        for payload in extract_jobpostings_from_jsonld(resp.text, careers_url, target["firm"]):
            if should_skip_custom_careers_page(payload.get("title", ""), payload.get("link", ""), payload.get("summary", "")):
                continue
            payload["target_firm"] = target["firm"]
            payload["target_careers_url"] = careers_url
            payload["target_category"] = target.get("primary_category", "")
            job_map.setdefault(payload["link"], payload)

        for page_url in pages_to_visit[:max_pages_per_target]:
            if deadline_reached():
                mark_source_runtime_event("CustomCareers", timed_out=1, note="custom careers deadline reached")
                return jobs
            if target_deadline_reached():
                mark_source_runtime_event("CustomCareers", timed_out=1, note=f"{target['firm']} target time slice exhausted")
                break
            try:
                page_resp = session.get(page_url, timeout=request_timeout())
            except requests.RequestException:
                continue
            if page_resp.status_code != 200:
                continue
            for payload in extract_jobpostings_from_jsonld(page_resp.text, page_url, target["firm"]):
                if should_skip_custom_careers_page(payload.get("title", ""), payload.get("link", ""), payload.get("summary", "")):
                    continue
                payload["target_firm"] = target["firm"]
                payload["target_careers_url"] = careers_url
                payload["target_category"] = target.get("primary_category", "")
                job_map.setdefault(payload["link"], payload)
            for link, title in extract_job_links(page_resp.text, page_url):
                if should_skip_custom_careers_page(title, link, ""):
                    continue
                if is_obvious_non_uk_custom_link(link):
                    continue
                job_map.setdefault(
                    link,
                    {
                        "title": title,
                        "company": target["firm"],
                        "location": "",
                        "link": link,
                        "posted_text": "",
                        "posted_date": "",
                        "summary": "",
                        "source": "CustomCareers",
                        "target_firm": target["firm"],
                        "target_careers_url": careers_url,
                        "target_category": target.get("primary_category", ""),
                    },
                )
            time.sleep(0.15)

        for link, job in list(job_map.items())[:max_detail_links_per_target]:
            if deadline_reached():
                mark_source_runtime_event("CustomCareers", timed_out=1, note="custom careers deadline reached")
                return jobs
            if target_deadline_reached():
                mark_source_runtime_event("CustomCareers", timed_out=1, note=f"{target['firm']} target time slice exhausted")
                break
            if is_obvious_non_uk_custom_link(link):
                job_map.pop(link, None)
                continue
            try:
                detail_resp = session.get(link, timeout=request_timeout())
            except requests.RequestException:
                continue
            if detail_resp.status_code != 200:
                continue
            details = parse_job_detail_jsonld(detail_resp.text, job.get("title", "")) or parse_job_detail_fallback(detail_resp.text)
            if details.get("title"):
                job["title"] = details["title"]
            if details.get("company"):
                job["company"] = details["company"]
            if details.get("location"):
                job["location"] = details["location"]
            if details.get("posted_date"):
                job["posted_date"] = details["posted_date"]
            elif details.get("posted_text"):
                job["posted_text"] = details["posted_text"]
            if details.get("summary"):
                job["summary"] = details["summary"]
            if should_skip_custom_careers_page(job.get("title", ""), link, job.get("summary", "")):
                job_map.pop(link, None)
                continue
            time.sleep(0.15)

        target_raw = len(job_map)
        mark_source_runtime_event("CustomCareers", raw=len(jobs) + target_raw)
        jobs.extend(job_map.values())
        if deadline_reached():
            mark_source_runtime_event("CustomCareers", timed_out=1, note="custom careers deadline reached")
            return jobs
        time.sleep(0.2)
    return jobs


def job_board_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for source in JOB_BOARD_SOURCES:
        before = len(jobs)
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
        count = len(jobs) - before
        if count > 0:
            print(f"  [{source['name']}] {count} jobs found")
        else:
            reason = ""
            if source["name"] == "IndeedUK":
                reason = " (likely blocked by anti-scraping)"
            elif source["name"] in ("Adzuna", "Jooble", "Reed", "CVLibrary"):
                reason = " (API key not configured?)"
            print(f"  [{source['name']}] 0 jobs found{reason}")
    return jobs
