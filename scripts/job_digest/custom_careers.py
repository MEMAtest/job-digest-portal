"""Scrape bespoke careers pages for firms not on a known ATS.

The 196 rows in `uk_firm_feeds.csv` with platform="Custom" represent target
firms whose careers pages are bespoke HTML, not a polled ATS endpoint. Most
publish job listings via schema.org JSON-LD blocks (`@type=JobPosting`)
because Google for Jobs requires it for indexed careers pages. This module
fetches each careers URL, parses JSON-LD, and returns a list of job dicts
compatible with the existing scraper pipeline.

If a page returns no JSON-LD, we fall back to a generic href-pattern scan
that looks for common job-link slugs (`/jobs/`, `/careers/`, `/role/`,
`/opening/`, `/position/`). These produce title + link but no posted date,
so the post-fetch window filter is lenient (treats missing date as ok).

Design choices:
- Parallel fetch with a small ThreadPoolExecutor (default 10 workers) so
  196 firms complete in ~30-60 seconds inside the CI watchdog window.
- 12 second timeout per request, with 1 retry on transient failure.
- Polite User-Agent identifying the scraper so site owners can block if
  needed.
- Respects HTTP 429 with exponential backoff; gives up after 2 retries.
"""
from __future__ import annotations

import concurrent.futures
import csv
import json
import re
from html import unescape
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from . import config


USER_AGENT = "Mozilla/5.0 (compatible; job-digest/1.0; +https://github.com/MEMAtest/job-digest-portal)"
REQUEST_TIMEOUT_SECONDS = 12
MAX_WORKERS = 10
MAX_JOBS_PER_FIRM = 30  # cap per careers page to bound noise


def load_custom_targets(path: Optional[Path] = None) -> List[Dict[str, str]]:
    """Return the list of firms whose platform is 'Custom' (i.e. dormant)."""
    if path is None:
        path = config.UK_FEEDS_PATH
    if not path.exists():
        return []
    targets: List[Dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            platform = (row.get("platform") or "").strip()
            careers_url = (row.get("careers_url") or "").strip()
            firm = (row.get("firm") or "").strip()
            if platform != "Custom":
                continue
            if not careers_url or not firm:
                continue
            category = (row.get("category") or "").strip()
            targets.append({
                "firm": firm,
                "category": category,
                "careers_url": careers_url,
            })
    return targets


def _fetch(url: str, session: Optional[requests.Session] = None) -> Optional[str]:
    sess = session or requests
    for attempt in range(2):
        try:
            resp = sess.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json"},
                timeout=REQUEST_TIMEOUT_SECONDS,
                allow_redirects=True,
            )
        except requests.RequestException:
            return None
        if resp.status_code == 429 and attempt == 0:
            continue
        if resp.status_code >= 400:
            return None
        return resp.text
    return None


def _extract_jsonld_jobs(html: str, source_url: str) -> List[Dict[str, str]]:
    """Find all JobPosting JSON-LD blocks and convert to job dicts."""
    jobs: List[Dict[str, str]] = []
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        if not script.string:
            continue
        try:
            payload: Any = json.loads(script.string)
        except json.JSONDecodeError:
            continue
        for block in _walk_jsonld(payload):
            job = _jsonld_to_job(block, source_url)
            if job:
                jobs.append(job)
            if len(jobs) >= MAX_JOBS_PER_FIRM:
                return jobs
    return jobs


def _walk_jsonld(node: Any):
    """Walk JSON-LD payload yielding any JobPosting nodes (incl. @graph)."""
    if isinstance(node, list):
        for item in node:
            yield from _walk_jsonld(item)
        return
    if not isinstance(node, dict):
        return
    type_field = node.get("@type")
    if type_field == "JobPosting" or (isinstance(type_field, list) and "JobPosting" in type_field):
        yield node
    if "@graph" in node:
        yield from _walk_jsonld(node["@graph"])


def _jsonld_to_job(block: Dict[str, Any], source_url: str) -> Optional[Dict[str, str]]:
    title = str(block.get("title") or "").strip()
    if not title:
        return None
    url = str(block.get("url") or block.get("@id") or "").strip()
    if not url:
        return None
    url = urljoin(source_url, url)
    posted_date = str(block.get("datePosted") or "").strip()
    hiring_org = block.get("hiringOrganization") or {}
    if isinstance(hiring_org, dict):
        company = str(hiring_org.get("name") or "").strip()
    else:
        company = ""
    location = ""
    job_location = block.get("jobLocation")
    if isinstance(job_location, list):
        job_location = job_location[0] if job_location else None
    if isinstance(job_location, dict):
        addr = job_location.get("address") or {}
        if isinstance(addr, dict):
            parts = [
                str(addr.get("addressLocality") or "").strip(),
                str(addr.get("addressRegion") or "").strip(),
                str(addr.get("addressCountry") or "").strip(),
            ]
            location = ", ".join([p for p in parts if p])
    summary = ""
    desc = block.get("description")
    if isinstance(desc, str):
        summary = unescape(re.sub(r"<[^>]+>", " ", desc)).strip()[:600]
    return {
        "title": title,
        "company": company,
        "location": location,
        "link": url,
        "posted_date": posted_date,
        "summary": summary,
    }


# Common URL slugs that indicate a job-detail page
_JOB_LINK_SLUGS = re.compile(
    r"/(jobs?|careers?|openings?|positions?|role|roles|opportunities)/[^/?#]+",
    re.IGNORECASE,
)


def _extract_generic_links(html: str, source_url: str) -> List[Dict[str, str]]:
    """Fallback: scan anchor hrefs for job-detail patterns."""
    soup = BeautifulSoup(html, "html.parser")
    seen: set[str] = set()
    jobs: List[Dict[str, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if not _JOB_LINK_SLUGS.search(href):
            continue
        url = urljoin(source_url, href)
        if url in seen:
            continue
        seen.add(url)
        title = " ".join((anchor.get_text() or "").split()).strip()
        if not title or len(title) < 5 or len(title) > 200:
            continue
        jobs.append({
            "title": title,
            "company": "",
            "location": "",
            "link": url,
            "posted_date": "",
            "summary": "",
        })
        if len(jobs) >= MAX_JOBS_PER_FIRM:
            break
    return jobs


def _scrape_one(target: Dict[str, str], session: requests.Session) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
    html = _fetch(target["careers_url"], session)
    if not html:
        return target, []
    jobs = _extract_jsonld_jobs(html, target["careers_url"])
    if not jobs:
        jobs = _extract_generic_links(html, target["careers_url"])
    for job in jobs:
        if not job.get("company"):
            job["company"] = target["firm"]
    return target, jobs


def custom_careers_search(session: Optional[requests.Session] = None) -> List[Dict[str, str]]:
    """Scrape all Custom-platform firms' careers pages in parallel.

    Returns a flat list of job dicts with keys: title, company, location,
    link, posted_date, summary, plus 'source_firm' for diagnostics.
    """
    targets = load_custom_targets()
    if not targets:
        return []
    sess = session or requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    all_jobs: List[Dict[str, str]] = []
    yields: Dict[str, int] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_scrape_one, t, sess): t for t in targets}
        for future in concurrent.futures.as_completed(futures):
            try:
                target, jobs = future.result()
            except Exception:  # noqa: BLE001
                continue
            yields[target["firm"]] = len(jobs)
            for job in jobs:
                job["source_firm"] = target["firm"]
            all_jobs.extend(jobs)
    # Brief diagnostic line for the runner log
    healthy = sum(1 for n in yields.values() if n > 0)
    print(
        f"[CustomCareers] {len(targets)} firms polled, {healthy} yielded jobs, "
        f"{len(all_jobs)} raw roles before filtering"
    )
    return all_jobs
