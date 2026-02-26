from __future__ import annotations

import os

from .config import UK_FEEDS_PATH, WORKDAY_SITES, dedupe_keep_order, load_uk_feed_targets

GREENHOUSE_BOARDS = [
    "complyadvantage",
    "appian",
    "socure",
    "symphonyai",
    "entrust",
    "quantexa",
    "kyckr",
    "kyc360",
    "ripjar",
    "fenergo",
    "veriff",
    "onfido",
    "trulioo",
    "sumsub",
    "napier",
    "plaid",
    "marqeta",
    "checkoutcom",
    "gocardless",
    "truelayer",
    "tink",
    "mollie",
    "klarna",
    "airwallex",
    "modulr",
    "mambu",
    "zopa",
    "thought-machine",
    "wise",
    "revolut",
    "monzo",
    "starlingbank",
    "clearbank",
    "oaknorth",
    "tide",
    "chip",
    "kroo",
    "curve",
    "fundingcircle",
    "lendable",
    "lexisnexis",
    "dowjones",
    "saphyre",
    "alloy",
    "finch",
    "snyk",
    "clearscore",
    "starlingbank",
    "tide",
    "truelayer",
    "mambu",
    "thoughtmachine",
    "rapyd",
    "plaid",
    "marqeta",
]

LEVER_BOARDS = [
    "onfido",
    "trulioo",
    "sumsub",
    "veriff",
    "kyckr",
    "clearscore",
    "tide",
    "monzo",
    "airwallex",
    "revolut",
    "checkout",
    "gocardless",
    "wise",
    "truelayer",
    "modulr",
    "curve",
    "chip",
    "kroo",
    "zopa",
    "oaknorth",
    "plaid",
    "marqeta",
    "fundingcircle",
    "lendable",
    "smartpension",
    "snyk",
    "checkoutcom",
    "worldremit",
    "azimo",
    "mambu",
    "thoughtmachine",
    "fenergo",
    "quantexa",
    "complyadvantage",
    "ripjar",
    "napier",
    "symphonyai",
    "lexisnexis",
    "actimize",
    "saphyre",
    "encompass",
]

SMARTRECRUITERS_COMPANIES = [
    "Visa",
    "Mastercard",
    "StandardChartered",
    "BNPParibas",
    "Citi",
    "UBS",
    "DeutscheBank",
    "LSEG",
    "SAP",
    "Oracle",
    "FIS",
    "Moody",
    "S&PGlobal",
    "NICE",
    "DowJones",
    "Barclays",
    "HSBC",
    "Lloyds",
    "NatWest",
    "Santander",
]

ASHBY_BOARDS = [
    "ramp",
    "brex",
    "mercury",
    "airwallex",
    "gocardless",
    "stripe",
    "checkout",
    "klarna",
    "wise",
    "revolut",
    "plaid",
    "marqeta",
    "truelayer",
    "mambu",
    "thoughtmachine",
]

EXTRA_GREENHOUSE = [x.strip() for x in os.getenv("JOB_DIGEST_GREENHOUSE_BOARDS", "").split(",") if x.strip()]
EXTRA_LEVER = [x.strip() for x in os.getenv("JOB_DIGEST_LEVER_BOARDS", "").split(",") if x.strip()]
EXTRA_SMARTRECRUITERS = [
    x.strip() for x in os.getenv("JOB_DIGEST_SMARTRECRUITERS", "").split(",") if x.strip()
]
EXTRA_ASHBY = [x.strip() for x in os.getenv("JOB_DIGEST_ASHBY_BOARDS", "").split(",") if x.strip()]

uk_feed_targets = load_uk_feed_targets(UK_FEEDS_PATH)
if uk_feed_targets["greenhouse"]:
    GREENHOUSE_BOARDS.extend(uk_feed_targets["greenhouse"])
if uk_feed_targets["lever"]:
    LEVER_BOARDS.extend(uk_feed_targets["lever"])
if uk_feed_targets["smartrecruiters"]:
    SMARTRECRUITERS_COMPANIES.extend(uk_feed_targets["smartrecruiters"])
if uk_feed_targets["ashby"]:
    ASHBY_BOARDS.extend(uk_feed_targets["ashby"])
if uk_feed_targets["workday"]:
    WORKDAY_SITES.extend(uk_feed_targets["workday"])

if EXTRA_GREENHOUSE:
    GREENHOUSE_BOARDS.extend(EXTRA_GREENHOUSE)
if EXTRA_LEVER:
    LEVER_BOARDS.extend(EXTRA_LEVER)
if EXTRA_SMARTRECRUITERS:
    SMARTRECRUITERS_COMPANIES.extend(EXTRA_SMARTRECRUITERS)
if EXTRA_ASHBY:
    ASHBY_BOARDS.extend(EXTRA_ASHBY)

GREENHOUSE_BOARDS = dedupe_keep_order(GREENHOUSE_BOARDS)
LEVER_BOARDS = dedupe_keep_order(LEVER_BOARDS)
SMARTRECRUITERS_COMPANIES = dedupe_keep_order(SMARTRECRUITERS_COMPANIES)
ASHBY_BOARDS = dedupe_keep_order(ASHBY_BOARDS)
WORKDAY_SITES = dedupe_keep_order(WORKDAY_SITES)

JOB_BOARD_SOURCES = [
    {"name": "WeWorkRemotely", "type": "rss", "url": "https://weworkremotely.com/categories/remote-product-jobs.rss"},
    {"name": "Remotive", "type": "api", "url": "https://remotive.com/api/remote-jobs"},
    {"name": "RemoteOK", "type": "api", "url": "https://remoteok.com/api"},
    {"name": "WorkAnywhere", "type": "rss", "url": "https://workanywhere.io/jobs.rss"},
    {"name": "RemoteYeah", "type": "rss", "url": "https://remoteyeah.com/jobs.rss"},
    {"name": "Jobicy", "type": "api", "url": "https://jobicy.com/api/v2/remote-jobs"},
    {"name": "MeetFrank", "type": "api", "url": "https://api.meetfrank.com/ai/jobs"},
    {"name": "Empllo", "type": "rss", "url": "https://empllo.com/rss/remote-product-jobs.rss"},
    {"name": "JobsCollider", "type": "rss", "url": "https://jobscollider.com/remote-jobs.rss"},
    {"name": "RealWorkFromAnywhere", "type": "rss", "url": "https://www.realworkfromanywhere.com/rss.xml"},
    {"name": "WorkAnywherePro", "type": "rss", "url": "https://workanywhere.pro/rss.xml"},
    {"name": "Adzuna", "type": "api", "url": "https://api.adzuna.com/v1/api/jobs/gb/search/1"},
    {"name": "Jooble", "type": "api", "url": "https://jooble.org/api"},
    {"name": "Reed", "type": "api", "url": "https://www.reed.co.uk/api/1.0/search"},
    {"name": "CVLibrary", "type": "api", "url": "https://www.cv-library.co.uk/search-jobs-json"},
    {"name": "Totaljobs", "type": "html", "url": "https://www.totaljobs.com"},
    {"name": "CWJobs", "type": "html", "url": "https://www.cwjobs.co.uk"},
    {"name": "Jobsite", "type": "html", "url": "https://www.jobsite.co.uk"},
    {"name": "Technojobs", "type": "html", "url": "https://www.technojobs.co.uk"},
    {"name": "BuiltInLondon", "type": "html", "url": "https://builtinlondon.uk"},
    {"name": "eFinancialCareers", "type": "html", "url": "https://www.efinancialcareers.co.uk"},
    {"name": "IndeedUK", "type": "html", "url": "https://uk.indeed.com"},
    {"name": "Workday", "type": "api", "url": "workday"},
    {"name": "JobServe", "type": "html", "url": "https://jobserve.com/gb/en/Job-Search/"},
]

JOB_BOARD_URLS = {source["name"]: source["url"] for source in JOB_BOARD_SOURCES}
