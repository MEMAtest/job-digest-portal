from __future__ import annotations

from typing import Dict, List, Tuple

from . import config

CORE_ROLE_PATTERNS = (
    "product manager",
    "senior product manager",
    "principal product manager",
    "product owner",
    "product lead",
    "product director",
    "product operations",
    "product management",
)

ADJACENT_ROLE_PATTERNS = (
    "business analyst",
    "lead business analyst",
    "delivery manager",
    "implementation",
    "transformation",
    "transformation lead",
    "business strategy",
    "strategy and execution",
    "execution lead",
    "operations strategy",
    "operating model",
    "process manager",
    "program manager",
    "programme manager",
    "product operations manager",
)

NEGATIVE_ROLE_PATTERNS = (
    "scrum master",
    "account manager",
    "internal communications",
    "communications",
    "product marketing",
    "marketing",
    "sales",
    "partnerships",
    "engineer",
    "developer",
    "architect",
    "designer",
    "recruiter",
    "talent",
    "customer success",
)


def has_domain_anchor(text: str) -> bool:
    text_l = text.lower()
    return any(term in text_l for term in config.DOMAIN_TERMS)


def classify_role_family(text: str) -> str:
    text_l = text.lower()
    if any(pattern in text_l for pattern in CORE_ROLE_PATTERNS):
        return "core"
    if any(pattern in text_l for pattern in ADJACENT_ROLE_PATTERNS):
        return "adjacent"
    if "product" in text_l and "manager" in text_l:
        return "core"
    if "product" in text_l or "platform" in text_l:
        return "adjacent"
    return "stretch"


def assess_fit(text: str, company: str, source_family: str = "", source: str = "") -> Dict[str, object]:
    text_l = text.lower()
    matched_domain = [t for t in config.DOMAIN_TERMS if t in text_l]
    matched_extra = [t for t in config.EXTRA_TERMS if t in text_l]
    negative_hits = [term for term in NEGATIVE_ROLE_PATTERNS if term in text_l]
    role_family = classify_role_family(text)
    domain_anchor = bool(matched_domain)

    score = 25

    if role_family == "core":
        score += 22
    elif role_family == "adjacent":
        score += 16
    elif "product" in text_l:
        score += 4

    if matched_domain:
        score += min(25, 5 * len(matched_domain))
        if role_family in {"core", "adjacent"}:
            score += 10
    if matched_extra:
        score += min(8 if domain_anchor else 3, 2 * len(matched_extra))

    if domain_anchor and any(term in text_l for term in ("process", "operational", "operations", "transformation")):
        score += 4
    elif any(term in text_l for term in ("process", "operational", "operations", "transformation")):
        score += 1

    company_l = company.lower()
    if any(v in company_l for v in config.VENDOR_COMPANIES):
        score += 8
    if any(f in company_l for f in config.FINTECH_COMPANIES):
        score += 4
    if any(b in company_l for b in config.BANK_COMPANIES):
        score += 3
    if any(t in company_l for t in config.TECH_COMPANIES):
        score += 2

    if "onboarding" in text_l or "kyc" in text_l:
        score += 4
    if "api" in text_l or "platform" in text_l:
        score += 2 if domain_anchor else 1

    if negative_hits:
        score -= min(24, 12 * len(negative_hits))

    if not domain_anchor:
        if source_family in {"JobBoard", "Aggregator"}:
            score = min(score, 64 if role_family == "core" else 55)
        elif role_family == "stretch":
            score = min(score, 58)
        elif source_family == "ATS" and role_family == "core":
            score = min(score, 72)
        elif source_family == "ATS" and role_family == "adjacent":
            score = min(score, 66)

    if source_family == "ATS" and role_family == "core" and domain_anchor:
        score += 4
    if source_family == "ATS" and role_family == "adjacent" and domain_anchor:
        score += 6
    if source_family == "ATS" and role_family == "core":
        score += 12
    elif source_family == "ATS" and role_family == "adjacent":
        score += 6
    if source_family == "ATS" and any(term in text_l for term in ("cards", "payments", "banking", "servicing")):
        score += 3

    score = max(0, min(score, 90))

    if negative_hits and not domain_anchor:
        fit_verdict = "STRETCH"
    elif role_family == "core" and domain_anchor and score >= 78:
        fit_verdict = "STRONG"
    elif source_family == "ATS" and role_family == "core" and score >= 72:
        fit_verdict = "PARTIAL"
    elif source_family == "ATS" and role_family == "core" and score >= 60:
        fit_verdict = "PARTIAL"
    elif role_family == "adjacent" and domain_anchor and score >= 60:
        fit_verdict = "PARTIAL"
    elif role_family in {"core", "adjacent"} and domain_anchor and score >= 68:
        fit_verdict = "PARTIAL"
    elif role_family == "core" and source_family == "ATS" and score >= 70:
        fit_verdict = "PARTIAL"
    else:
        fit_verdict = "STRETCH"

    return {
        "score": score,
        "matched_domain": matched_domain,
        "matched_extra": matched_extra,
        "role_family": role_family,
        "domain_anchor": domain_anchor,
        "negative_hits": negative_hits,
        "fit_verdict": fit_verdict,
        "source": source,
        "source_family": source_family,
    }


def score_fit(text: str, company: str) -> Tuple[int, List[str], List[str]]:
    result = assess_fit(text, company)
    return int(result["score"]), list(result["matched_domain"]), list(result["matched_extra"])


def build_reasons(text: str) -> str:
    text_l = text.lower()
    reasons = []
    for key, reason in config.REASON_HINTS.items():
        if key in text_l:
            reasons.append(reason)
    if not reasons:
        if has_domain_anchor(text):
            reasons.append("Direct overlap with your CLM, onboarding, screening, and financial crime delivery background.")
        else:
            reasons.append("Some structural overlap, but the role is less specific to your core CLM, onboarding, and financial crime experience.")
    return " ".join(reasons[:3])


def build_gaps(text: str) -> str:
    text_l = text.lower()
    gaps = []
    for key, hint in config.GAP_TERMS.items():
        if key in text_l:
            gaps.append(hint)
    if not gaps:
        if has_domain_anchor(text):
            gaps.append("No major domain gap; emphasize direct regulated workflow, platform, and cross-functional delivery experience.")
        else:
            gaps.append("Main gap is domain specificity; the role reads broader than your strongest CLM, onboarding, and financial crime track record.")
    return " ".join(gaps[:2])


def build_preference_match(text: str, company: str, location: str) -> str:
    text_l = text.lower()
    company_l = company.lower()
    location_l = location.lower()
    role_family = classify_role_family(text)

    parts = []
    if any(term in location_l for term in ["london", "remote", "united kingdom", "hybrid"]):
        parts.append("London/Remote UK")
    if role_family == "core":
        parts.append("Core role family")
    elif role_family == "adjacent":
        parts.append("Adjacent role family")
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
