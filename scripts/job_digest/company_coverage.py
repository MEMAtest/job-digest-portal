from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List
from urllib.parse import quote_plus

from . import keywords as kw

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
REGISTRY_PATH = SCRIPTS_DIR / "company_coverage_registry.csv"
LOCAL_FEEDS_PATH = SCRIPTS_DIR / "uk_firm_feeds.csv"
LOCAL_TARGETS_PATH = SCRIPTS_DIR / "company_targets_uk.txt"

REGISTRY_FIELDS = [
    "firm_id",
    "firm_name",
    "primary_category",
    "uk_relevance",
    "hq_region",
    "priority_tier",
    "fit_relevance",
    "careers_url",
    "canonical_platform",
    "canonical_feed_url",
    "alternate_endpoints_json",
    "search_aliases_json",
    "scrape_status",
    "scrape_method",
    "search_enabled",
    "feed_enabled",
    "uk_only_expected",
    "notes",
    "last_validated_at",
]

FEED_FIELDS = ["firm", "category", "platform", "careers_url", "feed_url", "workday_entry", "notes", "source"]

PLATFORM_PRIORITY = {
    "Greenhouse": 0,
    "Lever": 1,
    "Ashby": 2,
    "SmartRecruiters": 3,
    "Workable": 4,
    "Workday": 5,
    "Custom": 6,
    "LinkedInOnly": 7,
    "JobBoardFallback": 8,
}

CATEGORY_ORDER = {"Bank": 0, "Fintech": 1, "Regtech": 2}
STATUS_ORDER = {"covered": 0, "partial": 1, "missing": 2, "broken": 3}

CANONICAL_NAME_MAP = {
    "actimize": "NICE Actimize",
    "airwallex": "Airwallex",
    "bnpparibas": "BNP Paribas",
    "bnp paribas": "BNP Paribas",
    "brex": "Brex",
    "chip": "Chip",
    "checkout": "Checkout.com",
    "checkoutcom": "Checkout.com",
    "clearbank": "ClearBank",
    "complyadvantage": "ComplyAdvantage",
    "credit agricole": "Crédit Agricole",
    "curve": "Curve",
    "deutschebank": "Deutsche Bank",
    "dowjones": "Dow Jones",
    "engine by starling": "Engine by Starling",
    "encompass": "Encompass",
    "fenergo": "Fenergo",
    "fundingcircle": "Funding Circle",
    "gocardless": "GoCardless",
    "goldman sachs": "Goldman Sachs",
    "hsbc": "HSBC",
    "jpmorgan": "JPMorgan Chase",
    "jpmorgan chase": "JPMorgan Chase",
    "jpmorgan chase & co": "JPMorgan Chase",
    "kyc360": "KYC360",
    "kyckr": "Kyckr",
    "lexisnexis risk": "LexisNexis Risk",
    "lloyds": "Lloyds Banking Group",
    "mambu": "Mambu",
    "marqeta": "Marqeta",
    "metro bank": "Metro Bank",
    "modulr": "Modulr",
    "monzo": "Monzo",
    "moodys": "Moody's",
    "natwest": "NatWest Group",
    "napier": "Napier",
    "nice actimize": "NICE Actimize",
    "n26": "N26",
    "northern trust": "Northern Trust",
    "oaknorth": "OakNorth",
    "onfido": "Onfido",
    "plaid": "Plaid",
    "quantexa": "Quantexa",
    "rapyd": "Rapyd",
    "revolut": "Revolut",
    "ripjar": "Ripjar",
    "s&p global": "S&P Global",
    "s&pglobal": "S&P Global",
    "smartkyc": "smartKYC",
    "societe generale": "Société Générale",
    "societegenerale": "Société Générale",
    "snyk": "Snyk",
    "standard chartered": "Standard Chartered",
    "standardchartered": "Standard Chartered",
    "starling": "Starling Bank",
    "starlingbank": "Starling Bank",
    "starling bank": "Starling Bank",
    "sumsub": "Sumsub",
    "tesco bank": "Tesco Bank",
    "thought machine": "Thought Machine",
    "thoughtmachine": "Thought Machine",
    "thought-machine": "Thought Machine",
    "tide": "Tide",
    "trulioo": "Trulioo",
    "truelayer": "TrueLayer",
    "ubs": "UBS",
    "veriff": "Veriff",
    "virgin money": "Virgin Money",
    "wise": "Wise",
    "workinstartups": "WorkInStartups",
}

BANK_FIRMS = {
    "ABN AMRO", "AJ Bell", "Aldermore", "Allica Bank", "Bank of America", "Barclays", "BlackRock",
    "BNP Paribas", "BNY Mellon", "Close Brothers", "Co-operative Bank", "Coutts", "Coventry Building Society",
    "Crédit Agricole", "Deutsche Bank", "Fidelity", "FNZ", "Goldman Sachs", "Handelsbanken", "Hargreaves Lansdown",
    "HSBC", "ICBC Standard Bank", "IG Group", "ING", "Investec", "Jefferies", "JPMorgan Chase", "Julius Baer",
    "Lloyds Banking Group", "LSEG", "Macquarie", "Metro Bank", "Mizuho", "Morgan Stanley", "MUFG", "NatWest Group",
    "Nationwide", "Nomura", "Northern Trust", "Paragon Bank", "Rabobank", "RBC", "Rothschild", "Santander UK",
    "Schroders", "Secure Trust Bank", "Shawbrook", "Skipton Building Society", "SMBC", "Société Générale",
    "Standard Chartered", "State Street", "St. James's Place", "TSB", "UBS", "UniCredit", "Vanguard", "Vanquis Bank",
    "Virgin Money", "Yorkshire Building Society", "M&G", "Abrdn", "Tesco Bank", "OakNorth", "ClearBank", "Kroo",
    "Atom Bank", "Zopa", "Monzo", "Starling Bank", "Tide",
}

REGTECH_FIRMS = {
    "Actimize", "Alloy", "BioCatch", "Chainalysis", "ComplyAdvantage", "ComplyCube", "Elliptic", "Encompass",
    "Entrust", "Fenergo", "Feedzai", "Featurespace", "FinScan", "Fourthline", "Hawk", "Hawk AI", "IMTF",
    "Incode", "Jumio", "KYC360", "KYC Portal", "Kyckr", "LexisNexis Risk", "Lucinity", "Napier", "NICE Actimize",
    "Norbloc", "Onfido", "Persona", "Quantexa", "Refinitiv", "Resistant AI", "Ripjar", "Salv", "Saphyre",
    "Sigma360", "smartKYC", "Socure", "Strise", "Sumsub", "SymphonyAI", "Trulioo", "Unit21", "Veriff",
}

TIER1_FIRMS = {
    "Barclays", "HSBC", "NatWest Group", "Lloyds Banking Group", "Santander UK", "Standard Chartered", "Citi",
    "JPMorgan Chase", "Goldman Sachs", "Morgan Stanley", "Bank of America", "Deutsche Bank", "UBS", "BNP Paribas",
    "Société Générale", "Crédit Agricole", "LSEG", "Wise", "Revolut", "Monzo", "Starling Bank", "Tide", "Zopa",
    "OakNorth", "ClearBank", "Kroo", "Checkout.com", "Stripe", "Adyen", "GoCardless", "Modulr", "TrueLayer",
    "Airwallex", "Fenergo", "Quantexa", "ComplyAdvantage", "NICE Actimize", "Actimize", "Napier", "Onfido",
    "Sumsub", "Trulioo", "Veriff", "Ripjar", "Featurespace", "Elliptic", "Chainalysis",
}

ADJACENT_FIRMS = {
    "Vanguard", "Fidelity", "Abrdn", "Schroders", "M&G", "St. James's Place", "AJ Bell", "Hargreaves Lansdown",
    "FNZ", "PayPal", "Square", "Block", "Oracle", "SAP", "Moody's", "S&P Global", "Worldline", "Trustly",
}

CURATED_EXTRA_FIRMS = [
    ("Allica Bank", "Bank"), ("Shawbrook", "Bank"), ("Aldermore", "Bank"), ("Close Brothers", "Bank"),
    ("Paragon Bank", "Bank"), ("Secure Trust Bank", "Bank"), ("Vanquis Bank", "Bank"),
    ("Co-operative Bank", "Bank"), ("Skipton Building Society", "Bank"), ("Coventry Building Society", "Bank"),
    ("Yorkshire Building Society", "Bank"), ("Handelsbanken", "Bank"), ("Investec", "Bank"),
    ("ICBC Standard Bank", "Bank"), ("Julius Baer", "Bank"), ("Schroders", "Bank"), ("Abrdn", "Bank"),
    ("M&G", "Bank"), ("St. James's Place", "Bank"), ("Hargreaves Lansdown", "Bank"), ("AJ Bell", "Bank"),
    ("FNZ", "Bank"), ("CMC Markets", "Bank"), ("IG Group", "Bank"), ("Payhawk", "Fintech"),
    ("SumUp", "Fintech"), ("Paddle", "Fintech"), ("Trustly", "Fintech"), ("Volt", "Fintech"),
    ("Token.io", "Fintech"), ("Railsr", "Fintech"), ("Currencycloud", "Fintech"), ("Nium", "Fintech"),
    ("Banking Circle", "Fintech"), ("Griffin", "Fintech"), ("Moneybox", "Fintech"), ("Plum", "Fintech"),
    ("Snoop", "Fintech"), ("Monese", "Fintech"), ("Raisin", "Fintech"), ("Cashplus", "Fintech"),
    ("Qonto", "Fintech"), ("Spendesk", "Fintech"), ("Primer", "Fintech"), ("Worldline", "Fintech"),
    ("Mollie", "Fintech"), ("Trust Payments", "Fintech"), ("Tuum", "Fintech"), ("Juni", "Fintech"),
    ("Elliptic", "Regtech"), ("Chainalysis", "Regtech"), ("Featurespace", "Regtech"),
    ("ComplyCube", "Regtech"), ("Lucinity", "Regtech"), ("Hawk AI", "Regtech"), ("Unit21", "Regtech"),
    ("Resistant AI", "Regtech"), ("BioCatch", "Regtech"), ("Fourthline", "Regtech"), ("Salv", "Regtech"),
    ("Strise", "Regtech"), ("Persona", "Regtech"), ("Jumio", "Regtech"), ("Sardine", "Regtech"),
    ("Forter", "Regtech"), ("Quantifind", "Regtech"), ("Hawk", "Regtech"),
]

CURATED_DIRECT_ENDPOINTS = [
    {
        "firm": "Abrdn",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.aberdeenplc.com/en-gb/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Allica Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://careers.allica.bank/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "AJ Bell",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.ajbell.co.uk/group/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Atom Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.atombank.co.uk/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Aldermore",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.aldermore.co.uk/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Banking Circle",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.bankingcircle.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Close Brothers",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.closebrothers.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "FNZ",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.fnz.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Fidelity",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://careers.fidelityinternational.com/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "CMC Markets",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.cmcmarkets.com/en-gb/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Co-operative Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.co-operativebank.co.uk/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Coutts",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://jobs.natwestgroup.com/pages/coutts-careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Coventry Building Society",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.coventrycareers.co.uk/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Crédit Agricole",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.ca-cib.com/en/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Metro Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.metrobankonline.co.uk/about-us/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Hargreaves Lansdown",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://careers.hl.co.uk/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Handelsbanken",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.handelsbanken.co.uk/en/about-us/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "ICBC Standard Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.icbcstandard.com/en/Careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "IG Group",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.iggroup.com/corporate/careers.html",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Investec",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.investec.com/en_gb/welcome-to-investec/Careers.html",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Julius Baer",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.juliusbaer.com/en/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Jefferies",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.jefferies.com/Careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Macquarie",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.macquarie.com/careers.html",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "M&G",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.mandg.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Mizuho",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.mizuhogroup.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Monument Bank Limited",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.monument.co/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "MUFG",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.mufgemea.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Nationwide",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://jobs.nationwide.co.uk/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Nomura",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.nomura.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Northern Trust",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.northerntrust.com/united-states/about-us/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Paragon Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.paragonbank.co.uk/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Rabobank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.rabobank.com/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Schroders",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.schroders.com/en/global/individual/about-us/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Shawbrook",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.shawbrook.co.uk/about-us/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Skipton Building Society",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.skipton.co.uk/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Secure Trust Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.securetrustbank.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "SMBC",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.smbcgroup.com/emea/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "St. James's Place",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.sjp.co.uk/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "TSB",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://careers.tsb.co.uk/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Société Générale",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://careers.societegenerale.com/en/job-offers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Tesco Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.tescoplc.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Vanguard",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.vanguardjobs.com/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Virgin Money",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://uk.virginmoneycareers.com/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Vanquis Bank",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.vanquis.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Rothschild",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.rothschildandco.com/en/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "UniCredit",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.unicreditgroup.eu/en/careers.html",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Yorkshire Building Society",
        "category": "Bank",
        "platform": "Custom",
        "careers_url": "https://www.ybs.co.uk/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Adyen",
        "category": "Fintech",
        "platform": "Custom",
        "careers_url": "https://careers.adyen.com/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Chainalysis",
        "category": "Regtech",
        "platform": "Custom",
        "careers_url": "https://www.chainalysis.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Elliptic",
        "category": "Regtech",
        "platform": "Custom",
        "careers_url": "https://www.elliptic.co/careers",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
    {
        "firm": "Featurespace",
        "category": "Regtech",
        "platform": "Custom",
        "careers_url": "https://www.featurespace.com/careers/",
        "feed_url": "",
        "workday_entry": "",
        "notes": "Curated direct careers page",
        "source": "CuratedCustom",
    },
]


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or "firm"


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def canonicalize_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        return ""
    key = normalize_key(cleaned)
    if key in CANONICAL_NAME_MAP:
        return CANONICAL_NAME_MAP[key]
    return re.sub(r"\s+", " ", cleaned)


def infer_category(name: str, existing: str = "") -> str:
    existing = (existing or "").strip()
    if existing == "Bank":
        return existing
    if name in REGTECH_FIRMS:
        return "Regtech"
    if name in BANK_FIRMS or "bank" in name.lower() or "building society" in name.lower():
        return "Bank"
    if "bank" in existing.lower():
        return "Bank"
    # Do not trust a previously generated exact "Regtech" category from feed rows.
    # Only honor explicit mixed-source notes that still carry "regtech" semantics.
    if "regtech" in existing.lower() and "fintech" not in existing.lower() and existing not in {"Regtech", "Fintech"}:
        return "Regtech"
    return "Fintech"


def infer_priority(name: str, category: str) -> str:
    if name in TIER1_FIRMS:
        return "Tier1"
    if category == "Bank":
        return "Tier1" if any(token in name for token in ["Bank", "HSBC", "Barclays", "NatWest", "Lloyds", "JPMorgan", "Goldman", "Morgan Stanley", "UBS"]) else "Tier2"
    return "Tier2"


def infer_fit_relevance(name: str, category: str) -> str:
    if name in ADJACENT_FIRMS:
        return "Adjacent"
    if category in {"Bank", "Regtech"}:
        return "Core"
    return "Core"


def infer_uk_relevance(name: str, category: str) -> str:
    if category == "Bank" and any(token in name for token in ["NatWest", "Lloyds", "Barclays", "HSBC", "Santander", "Nationwide", "TSB", "Virgin Money", "Metro", "ClearBank", "OakNorth", "Kroo", "Monzo", "Starling", "Zopa", "Allica", "Shawbrook", "Aldermore"]):
        return "UK-HQ"
    return "UK-Presence"


def infer_hq_region(category: str, uk_relevance: str) -> str:
    if uk_relevance == "UK-HQ":
        return "United Kingdom"
    if category == "Bank":
        return "Global"
    return "EMEA"


def linkedin_search_url(name: str) -> str:
    return f"https://www.linkedin.com/jobs/search/?keywords={quote_plus(name)}&location=United%20Kingdom"


def load_feed_rows(path: Path) -> List[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_company_targets(path: Path) -> List[str]:
    if not path.exists():
        return []
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if value and not value.startswith("#"):
            lines.append(value)
    return lines


def seed_supported_feed_rows() -> List[dict]:
    from . import boards as board_inventory

    rows: List[dict] = []

    def add_row(firm: str, category: str, platform: str, careers_url: str, feed_url: str = "", workday_entry: str = "", notes: str = "", source: str = "") -> None:
        rows.append(
            {
                "firm": firm,
                "category": category,
                "platform": platform,
                "careers_url": careers_url,
                "feed_url": feed_url,
                "workday_entry": workday_entry,
                "notes": notes,
                "source": source or platform,
            }
        )

    for board in board_inventory.GREENHOUSE_BOARDS:
        firm = canonicalize_name(board.replace("-", " "))
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="Greenhouse",
            careers_url=f"https://boards.greenhouse.io/{board}",
            feed_url=f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs",
            notes="ATS feed from internal board list",
            source="internal_greenhouse_list",
        )
    for company in board_inventory.LEVER_BOARDS:
        firm = canonicalize_name(company.replace("-", " "))
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="Lever",
            careers_url=f"https://jobs.lever.co/{company}",
            feed_url=f"https://api.lever.co/v0/postings/{company}?mode=json",
            notes="ATS feed from internal board list",
            source="internal_lever_list",
        )
    for company in board_inventory.SMARTRECRUITERS_COMPANIES:
        firm = canonicalize_name(company.replace("-", " "))
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="SmartRecruiters",
            careers_url=f"https://jobs.smartrecruiters.com/{company}",
            feed_url=f"https://api.smartrecruiters.com/v1/companies/{company}/postings",
            notes="ATS feed from internal company list",
            source="internal_smartrecruiters_list",
        )
    for board in board_inventory.ASHBY_BOARDS:
        firm = canonicalize_name(board.replace("-", " "))
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="Ashby",
            careers_url=f"https://jobs.ashbyhq.com/{board}",
            feed_url=f"https://jobs.ashbyhq.com/api/non-user-graphql?op=job-board&board={board}",
            notes="ATS feed from internal board list",
            source="internal_ashby_list",
        )
    for account in board_inventory.WORKABLE_ACCOUNTS:
        firm = canonicalize_name(account.replace("-", " "))
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="Workable",
            careers_url=f"https://apply.workable.com/{account}/",
            feed_url=f"https://www.workable.com/api/accounts/{account}?details=true",
            notes="ATS feed from internal account list",
            source="internal_workable_list",
        )
    for entry in board_inventory.WORKDAY_SITES:
        firm_name, _, url = str(entry).partition("|")
        firm = canonicalize_name(firm_name or url)
        add_row(
            firm=firm,
            category=infer_category(firm),
            platform="Workday",
            careers_url=url,
            workday_entry=f"{firm}|{url}",
            notes="ATS feed from internal Workday list",
            source="internal_workday_list",
        )

    rows.extend(CURATED_DIRECT_ENDPOINTS)

    deduped: List[dict] = []
    seen = set()
    for row in rows:
        key = (
            canonicalize_name(row.get("firm", "")),
            (row.get("platform") or "").strip(),
            (row.get("feed_url") or "").strip(),
            (row.get("workday_entry") or "").strip(),
            (row.get("careers_url") or "").strip(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def existing_source_paths() -> tuple[Path, Path]:
    return LOCAL_FEEDS_PATH, LOCAL_TARGETS_PATH


def runtime_output_paths() -> tuple[Path, Path]:
    from . import config
    return config.UK_FEEDS_PATH, config.COMPANY_TARGETS_PATH


def build_registry_rows() -> List[dict]:
    local_feeds_path, local_targets_path = existing_source_paths()
    feed_rows = load_feed_rows(local_feeds_path)
    feed_rows.extend(seed_supported_feed_rows())
    deduped_feed_rows: List[dict] = []
    seen_feed_keys = set()
    for row in feed_rows:
        key = (
            canonicalize_name((row.get("firm") or "").strip()),
            (row.get("platform") or "").strip(),
            (row.get("careers_url") or "").strip(),
            (row.get("feed_url") or "").strip(),
            (row.get("workday_entry") or "").strip(),
        )
        if key in seen_feed_keys:
            continue
        seen_feed_keys.add(key)
        deduped_feed_rows.append(row)
    feed_rows = deduped_feed_rows
    target_names = set(load_company_targets(local_targets_path))
    target_names.update(kw.SEARCH_COMPANIES)
    for name, _category in CURATED_EXTRA_FIRMS:
        target_names.add(name)

    grouped_feed_rows: Dict[str, List[dict]] = defaultdict(list)
    aliases: Dict[str, set[str]] = defaultdict(set)

    for row in feed_rows:
        firm_name = canonicalize_name((row.get("firm") or "").strip())
        if not firm_name:
            continue
        grouped_feed_rows[firm_name].append(row)
        raw_firm = (row.get("firm") or "").strip()
        if raw_firm and raw_firm != firm_name:
            aliases[firm_name].add(raw_firm)

    curated_category = {canonicalize_name(name): category for name, category in CURATED_EXTRA_FIRMS}

    all_firms = {canonicalize_name(name) for name in target_names if canonicalize_name(name)} | set(grouped_feed_rows.keys())

    registry_rows: List[dict] = []
    for firm in sorted(all_firms, key=lambda value: (CATEGORY_ORDER.get(infer_category(value), 99), value.lower())):
        rows = grouped_feed_rows.get(firm, [])
        for alias in target_names:
            if canonicalize_name(alias) == firm and alias != firm:
                aliases[firm].add(alias)

        sorted_rows = sorted(rows, key=lambda row: PLATFORM_PRIORITY.get((row.get("platform") or "Custom").strip(), 99))
        primary = sorted_rows[0] if sorted_rows else {}
        primary_category = infer_category(firm, primary.get("category") or curated_category.get(firm, ""))
        priority_tier = infer_priority(firm, primary_category)
        fit_relevance = infer_fit_relevance(firm, primary_category)
        uk_relevance = infer_uk_relevance(firm, primary_category)
        hq_region = infer_hq_region(primary_category, uk_relevance)
        careers_url = (primary.get("careers_url") or "").strip()
        canonical_platform = (primary.get("platform") or "").strip() or ("LinkedInOnly" if not sorted_rows else "Custom")
        canonical_feed_url = (primary.get("feed_url") or primary.get("workday_entry") or "").strip()
        alternate_rows = []
        for alt in sorted_rows[1:]:
            alternate_rows.append(
                {
                    "platform": (alt.get("platform") or "").strip(),
                    "careers_url": (alt.get("careers_url") or "").strip(),
                    "feed_url": (alt.get("feed_url") or "").strip(),
                    "workday_entry": (alt.get("workday_entry") or "").strip(),
                    "source": (alt.get("source") or "").strip(),
                }
            )
        if not careers_url:
            careers_url = linkedin_search_url(firm)
        feed_enabled = bool(sorted_rows)
        search_enabled = True
        scrape_status = "covered" if sorted_rows else "partial"
        scrape_method = "api" if canonical_platform in {"Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Workable", "Workday"} else ("html" if sorted_rows else "search")
        notes = "; ".join(filter(None, dedupe_list([(primary.get("notes") or "").strip(), (primary.get("source") or "").strip()])))
        if not sorted_rows:
            notes = (notes + "; " if notes else "") + "LinkedIn/search fallback until direct careers path is mapped"
        registry_rows.append(
            {
                "firm_id": slugify(firm),
                "firm_name": firm,
                "primary_category": primary_category,
                "uk_relevance": uk_relevance,
                "hq_region": hq_region,
                "priority_tier": priority_tier,
                "fit_relevance": fit_relevance,
                "careers_url": careers_url,
                "canonical_platform": canonical_platform,
                "canonical_feed_url": canonical_feed_url,
                "alternate_endpoints_json": json.dumps(alternate_rows, ensure_ascii=False),
                "search_aliases_json": json.dumps(sorted(aliases[firm]), ensure_ascii=False),
                "scrape_status": scrape_status,
                "scrape_method": scrape_method,
                "search_enabled": "true" if search_enabled else "false",
                "feed_enabled": "true" if feed_enabled else "false",
                "uk_only_expected": "true",
                "notes": notes,
                "last_validated_at": "",
            }
        )
    return registry_rows


def dedupe_list(values: Iterable[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        cleaned = str(value or "").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        output.append(cleaned)
    return output


def read_registry(path: Path = REGISTRY_PATH) -> List[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_registry(rows: List[dict], path: Path = REGISTRY_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered_rows = sorted(rows, key=lambda row: (CATEGORY_ORDER.get(row.get("primary_category", ""), 99), row.get("priority_tier", "Tier9"), row.get("firm_name", "").lower()))
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=REGISTRY_FIELDS)
        writer.writeheader()
        writer.writerows(ordered_rows)


def registry_to_feed_rows(rows: List[dict]) -> List[dict]:
    feed_rows: List[dict] = []
    for row in rows:
        if (row.get("feed_enabled") or "").lower() != "true":
            continue
        platform = row.get("canonical_platform") or ""
        canonical_feed_url = row.get("canonical_feed_url") or ""
        workday_entry = canonical_feed_url if platform == "Workday" else ""
        feed_rows.append(
            {
                "firm": row.get("firm_name") or "",
                "category": row.get("primary_category") or "",
                "platform": platform,
                "careers_url": row.get("careers_url") or "",
                "feed_url": "" if platform == "Workday" else canonical_feed_url,
                "workday_entry": workday_entry,
                "notes": row.get("notes") or "",
                "source": row.get("canonical_platform") or "",
            }
        )
        for alt in json.loads(row.get("alternate_endpoints_json") or "[]"):
            platform = alt.get("platform") or ""
            feed_rows.append(
                {
                    "firm": row.get("firm_name") or "",
                    "category": row.get("primary_category") or "",
                    "platform": platform,
                    "careers_url": alt.get("careers_url") or row.get("careers_url") or "",
                    "feed_url": "" if platform == "Workday" else (alt.get("feed_url") or ""),
                    "workday_entry": alt.get("workday_entry") or "",
                    "notes": row.get("notes") or "",
                    "source": alt.get("source") or platform,
                }
            )
    return feed_rows


def registry_to_target_names(rows: List[dict]) -> List[str]:
    names: List[str] = []
    for row in rows:
        if (row.get("search_enabled") or "").lower() != "true":
            continue
        names.append(row.get("firm_name") or "")
        for alias in json.loads(row.get("search_aliases_json") or "[]"):
            names.append(alias)
    return dedupe_list(names)


def write_feed_rows(rows: List[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FEED_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def write_target_names(names: List[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(names) + "\n", encoding="utf-8")


def sync_generated_targets(rows: List[dict] | None = None) -> dict:
    registry_rows = rows if rows is not None else read_registry()
    if not registry_rows:
        registry_rows = build_registry_rows()
        write_registry(registry_rows)

    feed_rows = registry_to_feed_rows(registry_rows)
    target_names = registry_to_target_names(registry_rows)

    local_feeds_path, local_targets_path = existing_source_paths()
    runtime_feeds_path, runtime_targets_path = runtime_output_paths()

    write_feed_rows(feed_rows, local_feeds_path)
    write_target_names(target_names, local_targets_path)

    if runtime_feeds_path != local_feeds_path:
        write_feed_rows(feed_rows, runtime_feeds_path)
    if runtime_targets_path != local_targets_path:
        write_target_names(target_names, runtime_targets_path)

    return {
        "registry_count": len(registry_rows),
        "feed_rows": len(feed_rows),
        "search_targets": len(target_names),
        "local_feeds_path": str(local_feeds_path),
        "runtime_feeds_path": str(runtime_feeds_path),
        "local_targets_path": str(local_targets_path),
        "runtime_targets_path": str(runtime_targets_path),
    }


def compute_coverage_summary(rows: List[dict]) -> dict:
    total = len(rows)
    status_counts = Counter(row.get("scrape_status") or "missing" for row in rows)
    category_counts: Dict[str, dict] = {}
    tier_counts: Dict[str, dict] = {}
    platform_counts = Counter(row.get("canonical_platform") or "Unknown" for row in rows)

    for row in rows:
        category = row.get("primary_category") or "Unknown"
        tier = row.get("priority_tier") or "Unknown"
        status = row.get("scrape_status") or "missing"
        category_counts.setdefault(category, {"target": 0, "covered": 0, "partial": 0, "missing": 0, "broken": 0})
        tier_counts.setdefault(tier, {"target": 0, "covered": 0, "partial": 0, "missing": 0, "broken": 0})
        category_counts[category]["target"] += 1
        tier_counts[tier]["target"] += 1
        category_counts[category][status] = category_counts[category].get(status, 0) + 1
        tier_counts[tier][status] = tier_counts[tier].get(status, 0) + 1

    top_missing = [
        {
            "firm_name": row.get("firm_name") or "",
            "primary_category": row.get("primary_category") or "",
            "priority_tier": row.get("priority_tier") or "",
            "canonical_platform": row.get("canonical_platform") or "",
            "scrape_status": row.get("scrape_status") or "",
        }
        for row in rows
        if row.get("scrape_status") in {"missing", "broken", "partial"}
    ]
    top_missing.sort(key=lambda row: (STATUS_ORDER.get(row["scrape_status"], 99), row["priority_tier"], CATEGORY_ORDER.get(row["primary_category"], 99), row["firm_name"].lower()))

    return {
        "target_firms_total": total,
        "covered_firms_total": status_counts.get("covered", 0),
        "partial_firms_total": status_counts.get("partial", 0),
        "missing_firms_total": status_counts.get("missing", 0),
        "broken_firms_total": status_counts.get("broken", 0),
        "category_counts": category_counts,
        "platform_counts": dict(platform_counts),
        "tier_counts": tier_counts,
        "top_missing": top_missing[:12],
        "direct_coverage_rate": round((status_counts.get("covered", 0) / total) * 100, 1) if total else 0.0,
        "tier1_direct_coverage_rate": round((tier_counts.get("Tier1", {}).get("covered", 0) / max(tier_counts.get("Tier1", {}).get("target", 1), 1)) * 100, 1) if tier_counts.get("Tier1") else 0.0,
    }
