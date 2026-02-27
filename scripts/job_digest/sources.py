from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .boards import (
    ASHBY_BOARDS,
    GREENHOUSE_BOARDS,
    JOB_BOARD_SOURCES,
    JOB_BOARD_URLS,
    LEVER_BOARDS,
    SMARTRECRUITERS_COMPANIES,
    WORKDAY_SITES,
)
from .config import (
    ADZUNA_APP_ID,
    ADZUNA_APP_KEY,
    BOARD_KEYWORDS,
    BROAD_BOARD_KEYWORDS,
    CV_LIBRARY_API_KEY,
    EXCLUDE_COMPANIES,
    JOOBLE_API_KEY,
    REED_API_KEY,
    SEARCH_KEYWORDS,
    SEARCH_LOCATIONS,
    USER_AGENT,
)
from .models import JobRecord
from .utils import clean_link, extract_relative_posted_text, normalize_text, trim_summary

try:
    import feedparser
except Exception:  # noqa: BLE001
    feedparser = None

def linkedin_search(session: requests.Session) -> List[Dict[str, str]]:
    base_url = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    headers = {"User-Agent": USER_AGENT}
    jobs: Dict[str, Dict[str, str]] = {}

    for keywords in SEARCH_KEYWORDS:
        for location in SEARCH_LOCATIONS:
            for start in [0, 25]:
                params = {
                    "keywords": keywords,
                    "location": location,
                    "f_TPR": "r604800",
                    "start": start,
                }
                try:
                    resp = session.get(base_url, params=params, headers=headers, timeout=20)
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

                    jobs[job_id] = {
                        "job_id": job_id,
                        "title": title,
                        "company": company,
                        "location": location_text,
                        "posted_text": posted_text,
                        "posted_date": posted_date,
                        "link": clean_link(link),
                    }

                time.sleep(0.3)

    # Company-focused searches (narrower paging to reduce load)
    for company in select_company_batch(SEARCH_COMPANIES):
        for base_term in COMPANY_SEARCH_TERMS:
            keywords = f"{base_term} {company}"
            for location in SEARCH_LOCATIONS:
                for start in [0]:
                    params = {
                        "keywords": keywords,
                        "location": location,
                        "f_TPR": "r604800",
                        "start": start,
                    }
                    try:
                        resp = session.get(base_url, params=params, headers=headers, timeout=20)
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

                        jobs[job_id] = {
                            "job_id": job_id,
                            "title": title,
                            "company": company_name,
                            "location": location_text,
                            "posted_text": posted_text,
                            "posted_date": posted_date,
                            "link": clean_link(link),
                        }

                    time.sleep(0.2)

    return list(jobs.values())


def linkedin_job_details(session: requests.Session, job_id: str) -> Tuple[str, str, str, str]:
    detail_url = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    headers = {"User-Agent": USER_AGENT}
    try:
        resp = session.get(detail_url, headers=headers, timeout=20)
    except requests.RequestException:
        return "", "", "", ""
    if resp.status_code != 200:
        return "", "", "", ""

    soup = BeautifulSoup(resp.text, "html.parser")
    desc_el = soup.select_one("div.show-more-less-html__markup")
    desc_text = normalize_text(desc_el.get_text(" ")) if desc_el else ""

    posted_el = soup.select_one("span.posted-time-ago__text")
    posted_text = normalize_text(posted_el.get_text()) if posted_el else ""

    loc_el = soup.select_one("span.topcard__flavor--bullet")
    location_text = normalize_text(loc_el.get_text()) if loc_el else ""

    applicant_el = (
        soup.select_one("span.num-applicants__caption")
        or soup.select_one("figcaption.num-applicants__caption")
    )
    applicant_text = normalize_text(applicant_el.get_text()) if applicant_el else ""

    return desc_text, posted_text, location_text, applicant_text


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

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if not re.search(r"/job/|/jobs/|jobid=", href):
            continue
        if href.startswith("/"):
            href = urljoin(base_url, href)
        href = clean_link(href)
        if not href or href in seen:
            continue
        title = normalize_text(anchor.get_text(" "))
        if len(title) < 4:
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

    return {
        "title": title,
        "company": company,
        "location": "",
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
            .where("type", "==", "manual_link")
            .where("status", "==", "pending")
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
    score, _, _ = score_fit(full_text, company)
    why_fit = build_reasons(full_text)
    cv_gap = build_gaps(full_text)
    preference_match = build_preference_match(full_text, company, location)
    posted_value = posted_text or posted_date or ""

    return JobRecord(
        role=title,
        company=company or "Manual link",
        location=location or "Unknown",
        link=link,
        posted=posted_value,
        posted_raw=posted_value,
        posted_date=posted_date,
        source="Manual",
        fit_score=score,
        preference_match=preference_match,
        why_fit=why_fit,
        cv_gap=cv_gap,
        notes=summary or full_text[:500],
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
                "company": source_name,
                "location": "London",
                "link": link,
                "posted_text": "",
                "posted_date": "",
                "summary": "",
                "source": source_name,
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
        if not job_map[link]["posted_text"] and not job_map[link]["posted_date"]:
            posted_text = extract_relative_posted_text(resp.text)
            if posted_text:
                job_map[link]["posted_text"] = posted_text
        time.sleep(0.2)

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
                    resp = session.get(search_url, timeout=30)
                except requests.exceptions.SSLError:
                    try:
                        resp = session.get(search_url, timeout=30, verify=False)
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
    jobs: List[Dict[str, str]] = []
    base_url = JOB_BOARD_URLS.get("IndeedUK")
    if not base_url:
        return jobs

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://uk.indeed.com/",
    }

    rss_jobs: List[Dict[str, str]] = []
    for keyword in BROAD_BOARD_KEYWORDS[:3]:
        rss_url = f"{base_url}/rss?q={quote_plus(keyword)}&l=London&sort=date"
        entries = []
        if feedparser is not None:
            feed = feedparser.parse(rss_url)
            entries = list(feed.entries)
        if not entries:
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
            posted_date = parse_entry_date(entry)
            rss_jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": "London",
                    "link": clean_link(link),
                    "posted_text": "",
                    "posted_date": posted_date,
                    "summary": summary,
                    "source": "IndeedUK",
                }
            )
        time.sleep(0.2)
    if rss_jobs:
        return rss_jobs

    job_map: Dict[str, Dict[str, str]] = {}
    for keyword in BROAD_BOARD_KEYWORDS[:3]:
        params = {"q": keyword, "l": "London", "fromage": 3, "sort": "date"}
        try:
            resp = session.get(f"{base_url}/jobs", params=params, headers=headers, timeout=30)
        except requests.RequestException:
            continue
        if resp.status_code == 403:
            break
        if resp.status_code != 200:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")
        cards = soup.select("div.job_seen_beacon") or soup.select("a.tapItem")
        if cards:
            for card in cards:
                jk = card.get("data-jk")
                link = ""
                if jk:
                    link = f"{base_url}/viewjob?jk={jk}"
                else:
                    anchor = card.find("a", href=True)
                    if not anchor:
                        continue
                    href = anchor.get("href", "")
                    if "jk=" not in href and "/rc/clk" not in href and "/viewjob" not in href:
                        continue
                    link = urljoin(base_url, href)
                link = clean_link(link)
                if not link or link in job_map:
                    continue
                title_el = card.select_one("h2.jobTitle span") or card.select_one("a[data-jk]")
                title = normalize_text(title_el.get_text(" ")) if title_el else ""
                if len(title) < 4:
                    continue
                company_el = card.select_one("span.companyName")
                location_el = card.select_one("div.companyLocation")
                snippet_el = card.select_one("div.job-snippet")
                posted_el = card.select_one("span.date") or card.select_one("span[aria-label]")

                posted_text = ""
                if posted_el:
                    posted_text = extract_relative_posted_text(posted_el.get_text(" "))
                if not posted_text:
                    posted_text = extract_relative_posted_text(normalize_text(card.get_text(" ")))

                job_map[link] = {
                    "title": title,
                    "company": normalize_text(company_el.get_text(" ")) if company_el else "Indeed",
                    "location": normalize_text(location_el.get_text(" ")) if location_el else "London",
                    "link": link,
                    "posted_text": posted_text,
                    "posted_date": "",
                    "summary": trim_summary(snippet_el.get_text(" ") if snippet_el else ""),
                    "source": "IndeedUK",
                }
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
                job_map[link] = {
                    "title": title,
                    "company": "Indeed",
                    "location": "London",
                    "link": link,
                    "posted_text": "",
                    "posted_date": "",
                    "summary": "",
                    "source": "IndeedUK",
                }

        time.sleep(0.2)

    jobs.extend(job_map.values())
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


def job_board_search(session: requests.Session) -> List[Dict[str, str]]:
    jobs: List[Dict[str, str]] = []
    for source in JOB_BOARD_SOURCES:
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
    return jobs
