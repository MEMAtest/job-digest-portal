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
    "business architect",
    "process architect",
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
    "financial crime",
    "fincrime",
    "financial crime manager",
    "financial crime officer",
    "financial crime risk",
    "head of financial crime",
    "head of compliance",
    "head of financial crime risk",
    "compliance advisory",
    "compliance director",
    "compliance lead",
    "mlro",
    "money laundering reporting officer",
    "aml manager",
    "aml officer",
    "aml analyst",
    "aml compliance",
    "kyc manager",
    "kyc officer",
    "kyc analyst",
    "kyc compliance",
    "sanctions officer",
    "sanctions analyst",
    "sanctions compliance",
    "screening analyst",
    "screening officer",
    "onboarding manager",
    "onboarding lead",
    "regulatory affairs",
    "regulatory change",
    "regulatory controls",
    "regulatory compliance",
    "operational risk manager",
    "operational risk officer",
)


COMPLIANCE_BARE_TOKENS = (
    "compliance manager",
    "compliance officer",
    "compliance analyst",
    "compliance specialist",
)


RISK_BARE_TOKENS = (
    "risk manager",
    "risk officer",
    "risk analyst",
    "risk specialist",
)


# Bare "risk manager" or "compliance officer" alone is too broad (Marketing
# Risk Manager, Workplace Compliance Officer). Require co-occurrence with one
# of these tight fincrime/regulatory anchors before treating as adjacent.
FINCRIME_ANCHORS = (
    "aml", "kyc", "kyb", "cdd", "edd",
    "financial crime", "fincrime",
    "money laundering", "sanctions", "screening",
    "transaction monitoring", "perpetual kyc",
    "client lifecycle", "client onboarding", "customer lifecycle",
    "clm", "model risk", "regtech", "fraud",
    "due diligence", "fca", "mlr", "jmlsg", "bafin", "fatf",
)

TARGET_ANCHOR_GROUPS = {
    "Financial Crime": ("financial crime", "fincrime", "financial crimes"),
    "KYC": ("kyc", "know your customer"),
    "KYB": ("kyb", "know your business"),
    "AML": ("aml", "anti-money laundering", "money laundering"),
    "Screening": ("screening", "sanctions", "name screening", "payment screening", "adverse media", "pep"),
    "Onboarding": ("onboarding", "business onboarding", "customer onboarding", "client onboarding", "account opening"),
    "CLM": ("clm", "client lifecycle", "customer lifecycle", "fenergo", "fenx"),
    "Product": ("product manager", "product owner", "product lead", "product director", "product compliance", "product"),
}

TARGET_BOOST_TERMS = (
    "fenergo", "fenx", "napier", "lexisnexis", "lexis nexis", "bridger",
    "sanctions", "transaction monitoring", "case management", "workflow",
    "controls", "control design", "automation", "dashboard", "operating model",
    "1lod", "first line", "regtech", "policy compliance", "customer risk",
)

SELECTIVE_SCOPE_TERMS = (
    "systems", "system", "platform", "product", "controls", "control",
    "automation", "workflow", "operating model", "target operating model", "transformation",
    "implementation", "change", "process", "dashboard", "data", "1lod",
    "first line", "tooling", "technology",
)

CONTRACT_TERMS = (
    "contract", "contractor", "inside ir35", "outside ir35", "day rate",
    "fixed term", "ftc", "interim", "temporary", "/day", "per day",
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
    "designer",
    "recruiter",
    "talent",
    "customer success",
)

# Role TYPES Ade does not want, judged from the TITLE only. A fincrime JD for an
# MLRO/analyst/investigator role still mentions "product", "controls",
# "screening" etc., so without a title-level gate those roles score as high as a
# real Product Manager and dominate the feed. These push such titles below the
# score floor regardless of how domain-heavy the description is.
OFFLANE_TITLE_PATTERNS = (
    "analyst",
    "investigator",
    "money laundering reporting officer",
    "mlro",
    "fp&a",
    "business analyst",
    "project manager",
    "programme manager",
    "program manager",
    "operations analyst",
    "operations associate",
    "operations manager",
    "delivery manager",
    "data scientist",
    "scrum master",
    "recruiter",
    "accountant",
    "engineer",
    "developer",
)

# A genuine product-role TITLE overrides generic off-lane words (e.g. "manager").
PRODUCT_TITLE_PATTERNS = (
    "product manager",
    "senior product manager",
    "principal product manager",
    "group product manager",
    "lead product manager",
    "product owner",
    "senior product owner",
    "product lead",
    "product director",
    "head of product",
    "product compliance manager",
    "product compliance lead",
)

# Product titles that are still off-lane for Ade (wrong product specialism).
OFFLANE_PRODUCT_TITLES = (
    "data product manager",
    "technical product manager",
    "platform product manager",
)


def is_offlane_title(title_l: str) -> bool:
    """True if the TITLE is a role type Ade does not want (analyst/MLRO/etc.).

    Off-lane product variants (data/technical/platform PM) always count. Generic
    off-lane words (analyst, manager) are ignored when the title is a genuine
    product/owner role.
    """
    if any(p in title_l for p in OFFLANE_PRODUCT_TITLES):
        return True
    if any(p in title_l for p in PRODUCT_TITLE_PATTERNS):
        return False
    return any(p in title_l for p in OFFLANE_TITLE_PATTERNS)


def target_anchor_hits(text: str) -> List[str]:
    text_l = text.lower()
    hits: List[str] = []
    for label, terms in TARGET_ANCHOR_GROUPS.items():
        if any(term in text_l for term in terms):
            hits.append(label)
    return hits


def classify_target_role_bucket(text: str) -> str:
    """Map a role into Ade's job-search lanes.

    The bucket is intentionally stricter than generic relevance. It keeps the
    feed centred on financial crime product/controls/workflow roles while still
    allowing the user's requested Part 4 adjacent roles.
    """
    text_l = text.lower()
    anchors = set(target_anchor_hits(text_l))
    has_product = "Product" in anchors
    has_domain = bool(anchors & {"Financial Crime", "KYC", "KYB", "AML", "Screening", "Onboarding", "CLM"})
    has_screening = bool(anchors & {"Screening"}) or any(term in text_l for term in ("sanctions", "transaction monitoring"))
    has_clm = "CLM" in anchors
    has_scope = any(term in text_l for term in SELECTIVE_SCOPE_TERMS)
    has_contract = any(term in text_l for term in CONTRACT_TERMS)

    if has_product and has_domain:
        if "product compliance" in text_l or "compliance product" in text_l:
            return "product_compliance"
        if has_screening:
            return "screening_sanctions_product"
        if has_clm:
            return "clm_product_owner"
        if "regtech" in text_l or "aml platform" in text_l or "compliance automation" in text_l:
            return "regtech_product"
        return "core_product"

    if has_contract and has_domain and any(term in text_l for term in ("business analyst", "implementation", "transformation", "product owner")):
        return "contract_ba_transformation"

    if has_domain and any(term in text_l for term in ("business analyst", "implementation manager", "implementation lead", "product owner")):
        return "contract_ba_transformation" if has_contract else "selective_transformation"

    if has_domain and any(term in text_l for term in (
        "head of kyc", "head of onboarding", "head of financial crime",
        "financial crime senior manager", "financial crime manager",
        "fraud and financial crime senior manager", "risk product manager",
        "payments product manager", "payment risk product manager",
        "payments compliance product manager", "transformation lead",
        "transformation manager", "controls lead", "controls manager",
    )) and has_scope:
        return "selective_transformation"

    if has_domain and has_scope:
        return "fallback_adjacent"

    if has_product:
        return "generic_product"

    return "out_of_scope"


def has_domain_anchor(text: str) -> bool:
    text_l = text.lower()
    return any(term in text_l for term in config.DOMAIN_TERMS)


def classify_role_family(text: str) -> str:
    text_l = text.lower()
    if any(pattern in text_l for pattern in CORE_ROLE_PATTERNS):
        return "core"
    if any(pattern in text_l for pattern in ADJACENT_ROLE_PATTERNS):
        return "adjacent"
    # Bare "risk manager" / "compliance officer" only count as adjacent when
    # paired with a tight fincrime anchor. DOMAIN_TERMS would let "Marketing
    # Risk Manager" through because bare "risk" is in there.
    if any(tok in text_l for tok in COMPLIANCE_BARE_TOKENS + RISK_BARE_TOKENS):
        if any(anchor in text_l for anchor in FINCRIME_ANCHORS):
            return "adjacent"
    if "product" in text_l and "manager" in text_l:
        return "core"
    if "product" in text_l or "platform" in text_l:
        return "adjacent"
    return "stretch"


def assess_fit(text: str, company: str, source_family: str = "", source: str = "", title: str = "") -> Dict[str, object]:
    text_l = text.lower()
    title_l = (title or "").lower()
    classification_text = f"{title_l} {text_l}".strip()
    # Role TYPE is judged from the title only (when provided); domain anchors
    # still come from the full text. No title given -> no off-lane gate (keeps
    # the lighter score_fit() helper behaving as before).
    offlane_title = bool(title) and is_offlane_title(title_l)
    matched_domain = [t for t in config.DOMAIN_TERMS if t in text_l]
    matched_extra = [t for t in config.EXTRA_TERMS if t in text_l]
    negative_hits = [term for term in NEGATIVE_ROLE_PATTERNS if term in text_l]
    role_family = classify_role_family(classification_text)
    target_anchors = target_anchor_hits(classification_text)
    target_anchor_count = len(target_anchors)
    role_bucket = classify_target_role_bucket(classification_text)
    if role_bucket in {"contract_ba_transformation", "selective_transformation"}:
        offlane_title = False
    domain_anchor = bool(matched_domain) or target_anchor_count >= 2

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

    if target_anchor_count:
        score += min(20, 4 * target_anchor_count)

    if role_bucket in {"core_product", "product_compliance", "screening_sanctions_product", "clm_product_owner", "regtech_product"}:
        score += 12
    elif role_bucket == "contract_ba_transformation":
        score += 8
    elif role_bucket == "selective_transformation":
        score += 6
    elif role_bucket == "fallback_adjacent":
        score += 2
    elif role_bucket == "generic_product":
        score -= 10
    elif role_bucket == "out_of_scope":
        score -= 14

    boost_hits = [term for term in TARGET_BOOST_TERMS if term in text_l]
    if boost_hits:
        score += min(12, 2 * len(boost_hits))

    if domain_anchor and any(term in text_l for term in ("process", "operational", "operations", "transformation")):
        score += 4
    elif any(term in text_l for term in ("process", "operational", "operations", "transformation")):
        score += 1

    if domain_anchor and "business architect" in text_l:
        score += 8

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

    if role_bucket == "generic_product":
        score = min(score, 62 if source_family == "ATS" else 58)
    elif role_bucket == "out_of_scope":
        score = min(score, 54)
    elif role_bucket == "fallback_adjacent":
        score = min(score, 72)

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

    # Title is a role type Ade doesn't want (analyst/MLRO/investigator/FP&A/BA/
    # data-PM/etc.) — cap below the score floor so it can't reach the digest as a
    # strong match no matter how fincrime-heavy the JD is.
    if offlane_title:
        score = min(score, 45)

    score = max(0, min(score, 90))

    if offlane_title:
        fit_verdict = "STRETCH"
    elif negative_hits and not domain_anchor:
        fit_verdict = "STRETCH"
    elif role_bucket in {"core_product", "product_compliance", "screening_sanctions_product", "clm_product_owner", "regtech_product"} and score >= 78:
        fit_verdict = "STRONG"
    elif role_bucket in {"contract_ba_transformation", "selective_transformation"} and score >= 68:
        fit_verdict = "PARTIAL"
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
        "role_bucket": role_bucket,
        "target_anchors": target_anchors,
        "target_anchor_count": target_anchor_count,
        "target_boost_hits": boost_hits,
        "domain_anchor": domain_anchor,
        "negative_hits": negative_hits,
        "offlane_title": offlane_title,
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


def is_relevant_title_direct(title: str) -> bool:
    """Relaxed title filter for direct ATS sources.

    Direct ATS feeds (Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
    Workday) only return roles from target firms, so the company gate is
    implicit. The full LinkedIn-tuned is_relevant_title is too aggressive
    here — it requires title to contain product/platform/a domain term in
    addition to a role term, which drops legitimate target-firm roles like
    'Senior Manager, Compliance Strategy' that don't carry a product noun.

    Keep if: passes the EXCLUDE check AND contains any role-level term.
    Drop if: exclude term present (e.g. 'growth' for the growth-PM blocklist)
    or no role-level term at all (e.g. 'Junior Onboarding Analyst' — too
    junior).
    """
    title_l = title.lower()
    if any(term in title_l for term in config.EXCLUDE_TITLE_TERMS):
        return False
    if not any(req in title_l for req in config.ROLE_TITLE_REQUIREMENTS):
        return False
    return True


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
