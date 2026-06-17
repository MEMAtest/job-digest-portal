from __future__ import annotations

import csv
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from . import keywords as kw


def _load_env_defaults(paths: list[Path]) -> None:
    for path in paths:
        if not path.exists():
            continue
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key.startswith("export "):
                    key = key.removeprefix("export ").strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ and len(value) < 300:
                    os.environ[key] = value
        except Exception:
            continue


_load_env_defaults([
    Path.home() / ".job_digest.env",
    Path(__file__).resolve().parents[1] / ".env",
])

try:
    import pdfplumber
except Exception:  # noqa: BLE001
    pdfplumber = None

try:
    from pypdf import PdfReader
except Exception:  # noqa: BLE001
    PdfReader = None


DEFAULT_BASE_DIR = Path("/Users/adeomosanya/Documents/job apps/roles")
BASE_DIR = Path(os.getenv("JOB_DIGEST_BASE_DIR", str(DEFAULT_BASE_DIR)))
DIGEST_DIR = BASE_DIR / "digests"
DIGEST_DIR.mkdir(parents=True, exist_ok=True)

TZ_NAME = os.getenv("JOB_DIGEST_TZ", "Europe/London")
WINDOW_HOURS = int(os.getenv("JOB_DIGEST_WINDOW_HOURS", "168"))
MIN_SCORE = int(os.getenv("JOB_DIGEST_MIN_SCORE", "70"))
EMAIL_BORDERLINE_MIN_SCORE = int(os.getenv("JOB_DIGEST_EMAIL_BORDERLINE_MIN_SCORE", "50"))
EMAIL_BORDERLINE_MAX_SCORE = int(os.getenv("JOB_DIGEST_EMAIL_BORDERLINE_MAX_SCORE", "70"))
MAX_BORDERLINE_EMAIL_ROLES = int(os.getenv("JOB_DIGEST_MAX_BORDERLINE_EMAIL_ROLES", "12"))
MIN_LINKEDIN_BORDERLINE_ROLES = int(os.getenv("JOB_DIGEST_MIN_LINKEDIN_BORDERLINE_ROLES", "3"))
MAX_EMAIL_ROLES = int(os.getenv("JOB_DIGEST_MAX_EMAIL_ROLES", "12"))
MIN_EMAIL_ROLES = int(os.getenv("JOB_DIGEST_MIN_EMAIL_ROLES", "10"))
ALLOW_SEEN_TOP_UP = os.getenv("JOB_DIGEST_ALLOW_SEEN_TOP_UP", "false").strip().lower() in {"1", "true", "yes", "y"}
WRITE_SLOT_DIGESTS = os.getenv("JOB_DIGEST_WRITE_SLOT_DIGESTS", "true").strip().lower() in {"1", "true", "yes", "y"}
LINKEDIN_TARGET_WINDOW_HOURS = int(os.getenv("JOB_DIGEST_LINKEDIN_TARGET_WINDOW_HOURS", "72"))
LINKEDIN_CORE_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_LINKEDIN_CORE_QUERY_BUDGET", "36"))
LINKEDIN_ADJACENT_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_LINKEDIN_ADJACENT_QUERY_BUDGET", "18"))
LINKEDIN_EXPLORATORY_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_LINKEDIN_EXPLORATORY_QUERY_BUDGET", "6"))
LINKEDIN_MAX_GENERIC_TERMS = int(os.getenv("JOB_DIGEST_LINKEDIN_MAX_GENERIC_TERMS", "60"))
LINKEDIN_COMPANY_LIMIT = int(os.getenv("JOB_DIGEST_LINKEDIN_COMPANY_LIMIT", "18"))
LINKEDIN_COMPANY_TERM_LIMIT = int(os.getenv("JOB_DIGEST_LINKEDIN_COMPANY_TERM_LIMIT", "16"))
LINKEDIN_INCLUDED_COMPANIES = {
    item.strip().lower()
    for item in os.getenv(
        "JOB_DIGEST_LINKEDIN_INCLUDED_COMPANIES",
        "chainlink labs,checkout.com,fiserv,ki,napier ai,western union,x4 technology",
    ).split(",")
    if item.strip()
}
FAST_EMAIL_JOB_BOARD_SOURCES = {
    item.strip()
    for item in os.getenv("JOB_DIGEST_FAST_EMAIL_JOB_BOARD_SOURCES", "eFinancialCareers").split(",")
    if item.strip()
}
COMPANY_SEARCH_LIMIT = int(os.getenv("JOB_DIGEST_COMPANY_SEARCH_LIMIT", "0"))
STALE_DAYS = int(os.getenv("JOB_DIGEST_STALE_DAYS", "14"))
AUTO_DISMISS_BELOW = int(os.getenv("JOB_DIGEST_AUTO_DISMISS_BELOW", "0"))
NOTIFICATION_THRESHOLD = int(os.getenv("JOB_DIGEST_NOTIFICATION_THRESHOLD", "80"))
BOARD_CORE_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_BOARD_CORE_QUERY_BUDGET", "40"))
BOARD_ADJACENT_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_BOARD_ADJACENT_QUERY_BUDGET", "40"))
BOARD_EXPLORATORY_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_BOARD_EXPLORATORY_QUERY_BUDGET", "20"))
BOARD_MAX_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_BOARD_MAX_QUERY_BUDGET", "100"))
JOBSERVE_QUERY_BUDGET = int(os.getenv("JOB_DIGEST_JOBSERVE_QUERY_BUDGET", "3"))
NOTIFICATIONS_COLLECTION = os.getenv("FIREBASE_NOTIFICATIONS_COLLECTION", "notifications")
RUN_REQUESTS_COLLECTION = os.getenv("FIREBASE_RUN_REQUESTS_COLLECTION", "run_requests")
MANUAL_LINK_LIMIT = int(os.getenv("JOB_DIGEST_MANUAL_LINK_LIMIT", "10"))
PREFERENCES = os.getenv(
    "JOB_DIGEST_PREFERENCES",
    "London or remote UK · Product/Platform roles · KYC/AML/Onboarding/Sanctions/Screening · Min fit 70%",
)
SOURCES_SUMMARY_OVERRIDE = os.getenv("JOB_DIGEST_SOURCES", "")
SEEN_CACHE_PATH = Path(
    os.getenv("JOB_DIGEST_SEEN_CACHE", str(DIGEST_DIR / "sent_links.json"))
)
SEEN_CACHE_DAYS = int(os.getenv("JOB_DIGEST_SEEN_CACHE_DAYS", "14"))
RUN_AT = os.getenv("JOB_DIGEST_RUN_AT", "")
RUN_ATS = [t.strip() for t in os.getenv("JOB_DIGEST_RUN_ATS", "").split(",") if t.strip()]
RUN_WINDOW_MINUTES = int(os.getenv("JOB_DIGEST_RUN_WINDOW_MINUTES", "20"))
RUN_CATCH_UP_MINUTES = int(os.getenv("JOB_DIGEST_RUN_CATCH_UP_MINUTES", "240"))
RUN_STATE_PATH = Path(
    os.getenv("JOB_DIGEST_RUN_STATE", str(DIGEST_DIR / "run_state.json"))
)
FORCE_RUN = os.getenv("JOB_DIGEST_FORCE_RUN", "false").lower() == "true"
SUMMARY_MAX_CHARS = int(os.getenv("JOB_DIGEST_SUMMARY_MAX_CHARS", "1600"))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    # GitHub Actions injects unset secrets as "" — fall back to default rather
    # than crashing on int("").
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw.strip())
    except ValueError:
        return default


# --- Freshness + scarcity ranking (Part A) ---
# Fit stays dominant; these additive boosts let fresh, low-applicant high-fit
# roles float to the top. Missing signals never penalise (boost = 0).
FRESHNESS_RANKING_ENABLED = _env_bool("JOB_DIGEST_FRESHNESS_RANKING_ENABLED", True)
FRESHNESS_MAX_BOOST = _env_int("JOB_DIGEST_FRESHNESS_MAX_BOOST", 18)
FRESH_BOOST_2H = _env_int("JOB_DIGEST_FRESH_BOOST_2H", 12)
FRESH_BOOST_4H = _env_int("JOB_DIGEST_FRESH_BOOST_4H", 8)
FRESH_BOOST_12H = _env_int("JOB_DIGEST_FRESH_BOOST_12H", 4)
FRESH_BOOST_24H = _env_int("JOB_DIGEST_FRESH_BOOST_24H", 2)
SCARCITY_BOOST_LOW = _env_int("JOB_DIGEST_SCARCITY_BOOST_LOW", 8)    # <= 10 applicants
SCARCITY_BOOST_MED = _env_int("JOB_DIGEST_SCARCITY_BOOST_MED", 5)    # <= 25
SCARCITY_BOOST_HIGH = _env_int("JOB_DIGEST_SCARCITY_BOOST_HIGH", 2)  # <= 50

# --- "Apply now" hot lane (Part B) ---
HOT_LANE_MAX_HOURS = _env_float("JOB_DIGEST_HOT_LANE_MAX_HOURS", 4.0)
HOT_LANE_MIN_FIT = _env_int("JOB_DIGEST_HOT_LANE_MIN_FIT", 78)
HOT_LANE_MAX_APPLICANTS = _env_int("JOB_DIGEST_HOT_LANE_MAX_APPLICANTS", 25)
HOT_LANE_SUPPORTED_ATS_ONLY = _env_bool("JOB_DIGEST_HOT_LANE_SUPPORTED_ATS_ONLY", True)
HOT_LANE_MAX_ROLES = _env_int("JOB_DIGEST_HOT_LANE_MAX_ROLES", 5)
HOT_LANE_SUPPORTED_ATS = {"greenhouse", "lever", "ashby", "workable"}

# --- Fast detection hot-scan + Telegram (Part F) ---
HOT_SCAN_ENABLED = _env_bool("JOB_DIGEST_HOT_SCAN_ENABLED", True)
# Scanner threshold is on the FAST HEURISTIC score scale (no LLM), which runs
# ~10-15pts lower than the digest's LLM scores — strong, on-target roles (e.g. a
# KYC/Product PM at Veriff/Marqeta/Monzo) top out around 63-67 on the heuristic.
# So this floor is intentionally well below the digest hot-lane's HOT_LANE_MIN_FIT.
HOT_SCAN_MIN_FIT = _env_int("JOB_DIGEST_HOT_SCAN_MIN_FIT", 63)
# Cap alerts per scan so a backlog of currently-open matches can't flood the chat
# in one burst (the rest carry to the next scan via the not-yet-alerted dedup).
HOT_SCAN_MAX_ALERTS = _env_int("JOB_DIGEST_HOT_SCAN_MAX_ALERTS", 8)
# The scanner doesn't require a sub-4h posted timestamp (ATS feeds often omit it);
# "new since last scan" is the freshness signal. Still drop roles with a KNOWN
# posted date older than this, so a first scan doesn't alert on ancient backfill.
HOT_SCAN_MAX_AGE_HOURS = _env_float("JOB_DIGEST_HOT_SCAN_MAX_AGE_HOURS", 168.0)  # 7 days
HOT_ALERTED_CACHE_PATH = Path(
    os.getenv("JOB_DIGEST_HOT_ALERTED_CACHE", str(DIGEST_DIR / "hot_alerted.json"))
)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
SITE_URL = os.getenv("SITE_URL", "").rstrip("/")

EMAIL_ENABLED = os.getenv("JOB_DIGEST_EMAIL_ENABLED", "true").lower() == "true"
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "")
TO_EMAIL = os.getenv("TO_EMAIL", "ademolaomosanya@gmail.com")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "") or os.getenv("JOB_DIGEST_GEMINI_KEY", "")
GEMINI_MODEL = os.getenv("JOB_DIGEST_GEMINI_MODEL", "gemini-1.5-flash")
GEMINI_MAX_JOBS = int(os.getenv("JOB_DIGEST_GEMINI_MAX_JOBS", "20"))
GEMINI_TIMEOUT_SECONDS = int(os.getenv("JOB_DIGEST_GEMINI_TIMEOUT", "45"))
GEMINI_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv(
        "JOB_DIGEST_GEMINI_FALLBACK",
        "models/gemini-flash-latest,models/gemini-2.0-flash",
    ).split(",")
    if model.strip()
]
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("JOB_DIGEST_GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_JOBS = int(os.getenv("JOB_DIGEST_GROQ_MAX_JOBS", "20"))
GROQ_RATE_LIMIT_RPM = int(os.getenv("JOB_DIGEST_GROQ_RPM", "30"))
GROQ_DAILY_TOKEN_LIMIT = int(os.getenv("JOB_DIGEST_GROQ_DAILY_TOKEN_LIMIT", "14400"))
GROQ_TOKEN_WARN_RATIO = float(os.getenv("JOB_DIGEST_GROQ_TOKEN_WARN_RATIO", "0.8"))
GROQ_USAGE = {"tokens": 0, "calls": 0, "retries": 0}

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("JOB_DIGEST_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_CV_MAX_JOBS = int(os.getenv("JOB_DIGEST_OPENAI_CV_MAX_JOBS", "20"))

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("JOB_DIGEST_OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

JOB_DIGEST_CV_PATH = os.getenv(
    "JOB_DIGEST_CV_PATH",
    "/Users/adeomosanya/Downloads/Ade_Omosanya_CV_Master_Product_v11.pdf",
)
JOB_DIGEST_PROFILE = os.getenv(
    "JOB_DIGEST_PROFILE",
    "Global Product Owner with a decade of experience leading CLM, KYC and onboarding"
    " platform strategy across capital markets, fintech and digital banking."
    " Direct Fenergo CLM, Napier and Enate ownership across 30+ jurisdictions."
    " ACAMS Certified, ICA Fellow.",
)
JOB_DIGEST_DOCX_PATH = os.getenv(
    "JOB_DIGEST_DOCX_PATH",
    "/Users/adeomosanya/Downloads/Ademola_Enhanced_Full_Guide_v2.2_NoEvidence.docx",
)

ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID", "") or os.getenv("JOB_DIGEST_ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "") or os.getenv("JOB_DIGEST_ADZUNA_APP_KEY", "")
JOOBLE_API_KEY = os.getenv("JOOBLE_API_KEY", "") or os.getenv("JOB_DIGEST_JOOBLE_KEY", "")
REED_API_KEY = os.getenv("REED_API_KEY", "") or os.getenv("JOB_DIGEST_REED_KEY", "")
CV_LIBRARY_API_KEY = os.getenv("CV_LIBRARY_API_KEY", "") or os.getenv("JOB_DIGEST_CVLIB_KEY", "")

# Optional open-web discovery layer. This is deliberately off unless a search API
# key is configured, because scraping Google directly is brittle and likely to
# get blocked. Serper mirrors Google results and supports freshness filters.
WEB_DISCOVERY_ENABLED = _env_bool("JOB_DIGEST_WEB_DISCOVERY_ENABLED", True)
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "") or os.getenv("JOB_DIGEST_SERPER_API_KEY", "")
WEB_DISCOVERY_MAX_QUERIES = _env_int("JOB_DIGEST_WEB_DISCOVERY_MAX_QUERIES", 24)
WEB_DISCOVERY_RESULTS_PER_QUERY = _env_int("JOB_DIGEST_WEB_DISCOVERY_RESULTS_PER_QUERY", 10)
WEB_DISCOVERY_TBS = os.getenv("JOB_DIGEST_WEB_DISCOVERY_TBS", "qdr:d")

# Free recruiter-page discovery. These are public recruiter job-search pages
# aimed at contract/change roles; keep cadence lower than ATS to avoid noisy
# repeated scraping.
RECRUITER_PAGES_ENABLED = _env_bool("JOB_DIGEST_RECRUITER_PAGES_ENABLED", True)
RECRUITER_PAGES_RUN_HOURS = [
    int(part.strip())
    for part in os.getenv("JOB_DIGEST_RECRUITER_PAGES_RUN_HOURS", "6,7,14,15").split(",")
    if part.strip().isdigit()
]
RECRUITER_PAGES_MAX_SEARCH_URLS = _env_int("JOB_DIGEST_RECRUITER_PAGES_MAX_SEARCH_URLS", 4)
RECRUITER_PAGES_MAX_DETAIL_LINKS = _env_int("JOB_DIGEST_RECRUITER_PAGES_MAX_DETAIL_LINKS", 6)

WORKDAY_SITES = [
    entry.strip()
    for entry in os.getenv("JOB_DIGEST_WORKDAY_SITES", "").split(",")
    if entry.strip()
]
WORKDAY_SITES_FILE = Path(os.getenv("JOB_DIGEST_WORKDAY_FILE", str(BASE_DIR / "workday_sites.txt")))
COMPANY_TARGETS_PATH = Path(
    os.getenv("JOB_DIGEST_COMPANY_TARGETS", str(BASE_DIR / "company_targets_uk.txt"))
)
UK_FEEDS_PATH = Path(os.getenv("JOB_DIGEST_UK_FEEDS", str(BASE_DIR / "uk_firm_feeds.csv")))

FIREBASE_SERVICE_ACCOUNT_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
FIREBASE_SERVICE_ACCOUNT_B64 = os.getenv("FIREBASE_SERVICE_ACCOUNT_B64", "")
FIREBASE_SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "")
FIREBASE_COLLECTION = os.getenv("FIREBASE_COLLECTION", "jobs")

USER_AGENT = os.getenv(
    "JOB_DIGEST_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
)

# Re-export keyword lists (base lists are in keywords.py)
SEARCH_KEYWORDS = list(kw.SEARCH_KEYWORDS)
BOARD_KEYWORDS = list(kw.BOARD_KEYWORDS)
BROAD_BOARD_KEYWORDS = list(kw.BROAD_BOARD_KEYWORDS)
TIER1_CORE_BOARD_KEYWORDS = list(kw.TIER1_CORE_BOARD_KEYWORDS)
TIER2_ADJACENT_BOARD_KEYWORDS = list(kw.TIER2_ADJACENT_BOARD_KEYWORDS)
TIER3_EXPLORATORY_BOARD_KEYWORDS = list(kw.TIER3_EXPLORATORY_BOARD_KEYWORDS)
COMPANY_SEARCH_TERMS = list(kw.COMPANY_SEARCH_TERMS)
SEARCH_LOCATIONS = list(kw.SEARCH_LOCATIONS)
EXCLUDE_LOCATION_TERMS = set(kw.EXCLUDE_LOCATION_TERMS)
EXCLUDE_TITLE_TERMS = set(kw.EXCLUDE_TITLE_TERMS)
EXCLUDE_COMPANIES = set(kw.EXCLUDE_COMPANIES)
ROLE_TITLE_REQUIREMENTS = set(kw.ROLE_TITLE_REQUIREMENTS)
VENDOR_COMPANIES = set(kw.VENDOR_COMPANIES)
FINTECH_COMPANIES = set(kw.FINTECH_COMPANIES)
BANK_COMPANIES = set(kw.BANK_COMPANIES)
TECH_COMPANIES = set(kw.TECH_COMPANIES)
DOMAIN_TERMS = list(kw.DOMAIN_TERMS)
EXTRA_TERMS = list(kw.EXTRA_TERMS)
GAP_TERMS = dict(kw.GAP_TERMS)
REASON_HINTS = dict(kw.REASON_HINTS)


def dedupe_keep_order(items: List[str]) -> List[str]:
    seen: set[str] = set()
    deduped: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def load_uk_feed_targets(path: Path) -> Dict[str, List[str]]:
    targets: Dict[str, List[str]] = {
        "greenhouse": [],
        "lever": [],
        "smartrecruiters": [],
        "ashby": [],
        "workable": [],
        "workday": [],
    }
    if not path.exists():
        return targets
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                platform = (row.get("platform") or "").strip().lower()
                feed_url = (row.get("feed_url") or "").strip()
                workday_entry = (row.get("workday_entry") or "").strip()
                if platform == "greenhouse" and "/boards/" in feed_url:
                    board = feed_url.split("/boards/")[1].split("/")[0]
                    if board:
                        targets["greenhouse"].append(board)
                elif platform == "lever" and "/postings/" in feed_url:
                    company = feed_url.split("/postings/")[1].split("?")[0]
                    if company:
                        targets["lever"].append(company)
                elif platform == "smartrecruiters" and "/companies/" in feed_url:
                    company = feed_url.split("/companies/")[1].split("/")[0]
                    if company:
                        targets["smartrecruiters"].append(company)
                elif platform == "ashby" and "/job-board/" in feed_url:
                    board = feed_url.split("/job-board/")[1].split("/")[0]
                    if board:
                        targets["ashby"].append(board)
                elif platform == "workable":
                    account = ""
                    if "/api/accounts/" in feed_url:
                        account = feed_url.split("/api/accounts/")[1].split("?")[0].split("/")[0]
                    elif "apply.workable.com/" in feed_url:
                        account = feed_url.split("apply.workable.com/")[1].split("/")[0]
                    elif "apply.workable.com/" in (row.get("careers_url") or ""):
                        account = (row.get("careers_url") or "").split("apply.workable.com/")[1].split("/")[0]
                    if account:
                        targets["workable"].append(account)
                elif platform == "workday" and workday_entry:
                    targets["workday"].append(workday_entry)
    except OSError:
        return targets
    return targets


def load_target_list(path: Path) -> List[str]:
    if not path.exists():
        return []
    lines = []
    for line in path.read_text().splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#"):
            continue
        lines.append(cleaned)
    return lines


def select_company_batch(companies: List[str]) -> List[str]:
    if COMPANY_SEARCH_LIMIT <= 0 or len(companies) <= COMPANY_SEARCH_LIMIT:
        return companies
    day_index = int(datetime.now().strftime("%j"))
    offset = (day_index * COMPANY_SEARCH_LIMIT) % len(companies)
    return [companies[(offset + idx) % len(companies)] for idx in range(COMPANY_SEARCH_LIMIT)]


SEARCH_COMPANIES = list(kw.SEARCH_COMPANIES)
extra_company_targets = load_target_list(COMPANY_TARGETS_PATH)
if extra_company_targets:
    SEARCH_COMPANIES.extend(extra_company_targets)
SEARCH_COMPANIES = dedupe_keep_order(SEARCH_COMPANIES)

workday_file_entries = load_target_list(WORKDAY_SITES_FILE)
if workday_file_entries:
    WORKDAY_SITES.extend(workday_file_entries)
WORKDAY_SITES = dedupe_keep_order(WORKDAY_SITES)


def load_cv_text(path_str: str) -> str:
    if not path_str:
        return ""
    path = Path(path_str)
    if not path.exists():
        return ""

    if path.suffix.lower() != ".pdf":
        try:
            return path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeDecodeError):
            return ""

    text_chunks: List[str] = []
    if pdfplumber is not None:
        try:
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    if page_text:
                        text_chunks.append(page_text)
        except Exception:
            text_chunks = []
    elif PdfReader is not None:
        try:
            reader = PdfReader(str(path))
            for page in reader.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    text_chunks.append(page_text)
        except Exception:
            text_chunks = []

    return "\n".join(text_chunks).strip()


def load_docx_text(path_str: str) -> str:
    if not path_str:
        return ""
    path = Path(path_str)
    if not path.exists():
        return ""
    try:
        import zipfile
    except Exception:
        return ""
    try:
        with zipfile.ZipFile(path) as zf:
            if "word/document.xml" not in zf.namelist():
                return ""
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
    except Exception:
        return ""
    text = re.sub(r"<[^>]+>", " ", xml)
    return re.sub(r"\s+", " ", text).strip()


JOB_DIGEST_PROFILE_TEXT = "\n\n".join(
    part
    for part in [
        load_cv_text(JOB_DIGEST_CV_PATH),
        load_docx_text(JOB_DIGEST_DOCX_PATH),
        JOB_DIGEST_PROFILE,
    ]
    if part
).strip()
