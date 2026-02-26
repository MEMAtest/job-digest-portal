from __future__ import annotations

from typing import List, Tuple

from . import config


def score_fit(text: str, company: str) -> Tuple[int, List[str], List[str]]:
    text_l = text.lower()
    matched_domain = [t for t in config.DOMAIN_TERMS if t in text_l]
    matched_extra = [t for t in config.EXTRA_TERMS if t in text_l]

    score = 60
    if matched_domain:
        score += min(20, 4 * len(matched_domain))
    if matched_extra:
        score += min(10, 2 * len(matched_extra))
    if "product" in text_l:
        score += 5
    if any(
        term in text_l
        for term in (
            "product manager",
            "product owner",
            "product lead",
            "product director",
            "product operations",
            "product management",
        )
    ):
        score += 3
    if any(term in text_l for term in ("process", "operational", "operations", "transformation")):
        score += 2
    company_l = company.lower()
    if any(v in company_l for v in config.VENDOR_COMPANIES):
        score += 12
    if any(f in company_l for f in config.FINTECH_COMPANIES):
        score += 8
    if any(b in company_l for b in config.BANK_COMPANIES):
        score += 6
    if any(t in company_l for t in config.TECH_COMPANIES):
        score += 4
    if "onboarding" in text_l or "kyc" in text_l:
        score += 3
    if "api" in text_l:
        score += 3

    return min(score, 90), matched_domain, matched_extra


def build_reasons(text: str) -> str:
    text_l = text.lower()
    reasons = []
    for key, reason in config.REASON_HINTS.items():
        if key in text_l:
            reasons.append(reason)
    if not reasons:
        reasons.append("Strong fit with your financial crime, onboarding, and platform delivery background.")
    return " ".join(reasons[:3])


def build_gaps(text: str) -> str:
    text_l = text.lower()
    gaps = []
    for key, hint in config.GAP_TERMS.items():
        if key in text_l:
            gaps.append(hint)
    if not gaps:
        gaps.append("No obvious gaps; emphasize cross-functional delivery and regulated environment experience.")
    return " ".join(gaps[:2])


def build_preference_match(text: str, company: str, location: str) -> str:
    text_l = text.lower()
    company_l = company.lower()
    location_l = location.lower()

    parts = []
    if any(term in location_l for term in ["london", "remote", "united kingdom", "hybrid"]):
        parts.append("London/Remote UK")
    if "product" in text_l:
        parts.append("Product role")
    if any(term in text_l for term in ["kyc", "aml", "screening", "onboarding", "financial crime", "sanctions"]):
        parts.append("KYC/AML/Onboarding")
    if any(vendor in company_l for vendor in config.VENDOR_COMPANIES):
        parts.append("RegTech/Vendor")
    if any(fintech in company_l for fintech in config.FINTECH_COMPANIES):
        parts.append("Fintech/Payments")
    if any(bank in company_l for bank in config.BANK_COMPANIES):
        parts.append("Bank/FS")
    if any(tech in company_l for tech in config.TECH_COMPANIES):
        parts.append("Big Tech")
    if "api" in text_l or "platform" in text_l:
        parts.append("Platform/API")

    return " · ".join(parts) if parts else "General product fit"


def is_relevant_title(title: str) -> bool:
    title_l = title.lower()
    if any(term in title_l for term in config.EXCLUDE_TITLE_TERMS):
        return False
    has_role_term = any(req in title_l for req in config.ROLE_TITLE_REQUIREMENTS)
    if not has_role_term:
        return False
    if "product" in title_l:
        return True
    if any(term in title_l for term in config.DOMAIN_TERMS):
        return True
    if "platform" in title_l:
        return True
    return False


def is_relevant_location(location: str, text: str = "") -> bool:
    combined = f"{location} {text}".lower()
    if "northern ireland" in combined:
        return True
    if any(term in combined for term in config.EXCLUDE_LOCATION_TERMS):
        return False
    uk_terms = [
        "london",
        "greater london",
        "united kingdom",
        "england",
        "scotland",
        "wales",
        "uk",
        "gb",
        "great britain",
    ]
    if any(term in combined for term in uk_terms):
        return True
    if "remote" in combined or "hybrid" in combined:
        return any(term in combined for term in uk_terms)
    return False
