"""Daily Focus block: rotates per fire so each email has a different focus.

Theme by hour of day (UTC):
  - 07 UTC (08 BST) → Quote
  - 11 UTC (12 BST) → Term of the day
  - 15 UTC (16 BST) → Reflection prompt
  - 19 UTC (20 BST) → Industry Watch (LIVE from FCA news RSS)
  - any other hour → Quote (manual/ad-hoc runs)

State persistence:
  focus_state.json (in DIGEST_DIR) remembers the last ~30 items shown so we
  don't repeat. Falls back gracefully on missing/corrupt state.

Industry Watch:
  Fetches the FCA news RSS feed (https://www.fca.org.uk/news/rss.xml) and
  picks the most recent article that hasn't been shown in the last 30 picks.
  Network failure falls back to a small static pool so the email still
  renders.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import List, Optional, Tuple

from . import config


# (category, headline, body, optional URL)
FocusItem = Tuple[str, str, str, Optional[str]]


QUOTES: List[FocusItem] = [
    ("Quote", "Alan Kay",
     "The best way to predict the future is to invent it.", None),
    ("Quote", "Warren Buffett",
     "It takes 20 years to build a reputation and five minutes to ruin it. If you think about that, you'll do things differently.", None),
    ("Quote", "Marcus Aurelius",
     "You have power over your mind, not outside events. Realise this, and you will find strength.", None),
    ("Quote", "Jeff Bezos",
     "Most decisions should probably be made with somewhere around 70% of the information you wish you had. If you wait for 90%, in most cases, you're probably being slow.", None),
    ("Quote", "Maya Angelou",
     "People will forget what you said, people will forget what you did, but people will never forget how you made them feel.", None),
    ("Quote", "Reid Hoffman",
     "An entrepreneur is someone who jumps off a cliff and builds a plane on the way down.", None),
    ("Quote", "Naval Ravikant",
     "Play long-term games with long-term people. All returns in life, whether wealth, relationships, or knowledge, come from compound interest.", None),
    ("Quote", "Charlie Munger",
     "The big money is not in the buying or the selling, but in the waiting.", None),
    ("Quote", "Annie Duke",
     "The quality of our lives is the sum of decision quality plus luck. Resulting (judging decisions by outcomes) is the most damaging cognitive shortcut in business.", None),
    ("Quote", "Andy Grove",
     "Bad companies are destroyed by crisis. Good companies survive them. Great companies are improved by them.", None),
    ("Quote", "Peter Drucker",
     "The most important thing in communication is hearing what isn't said.", None),
    ("Quote", "Indra Nooyi",
     "If you want to do something to lift yourself up, lift someone else up.", None),
]


TERMS: List[FocusItem] = [
    ("Term", "Perpetual KYC (pKYC)",
     "A risk-based model where customer due diligence is refreshed by event triggers (transaction patterns, sanctions changes, beneficial-ownership updates) rather than fixed periodic reviews. FCA, MAS and DNB have all signalled support; tooling maturity is the practical bottleneck.",
     "https://www.fca.org.uk/firms/financial-crime"),
    ("Term", "Three Lines of Defence",
     "1st line: the business owns the risk and runs controls. 2nd line: compliance/risk function challenges and oversees. 3rd line: internal audit gives assurance to the board. Product Compliance roles often sit at 1.5 — first line but with significant judgement.",
     "https://www.theiia.org/en/content/articles/global-knowledge-brief/2020/july/the-three-lines-model/"),
    ("Term", "Alert-to-SAR ratio",
     "The share of transaction-monitoring alerts that convert to Suspicious Activity Reports. Under ~5% flags noisy rules; unusually high can flag rules too narrow that miss real activity. Always pair with recall — what was missed.", None),
    ("Term", "Model Risk Management",
     "Framework for managing risks from ML and statistical models in fincrime, fraud, credit. Covers development controls, independent validation, explainability, drift monitoring, break-glass procedures. PRA SS1/23 + FCA expectations apply in the UK.",
     "https://www.bankofengland.co.uk/prudential-regulation/publication/2023/may/model-risk-management-principles-for-banks-ss"),
    ("Term", "Risk-Based Approach (RBA)",
     "The FATF principle that AML/CFT controls should be proportionate to assessed risk. In product terms: don't apply uniform friction — segment customers by risk and adjust onboarding, monitoring intensity, and review cadence accordingly.",
     "https://www.fatf-gafi.org/en/topics/risk-based-approach.html"),
    ("Term", "Embedded Finance",
     "Non-financial platforms (marketplaces, SaaS, gig apps) offering banking, payments, lending or cards via APIs from a regulated provider. Wise Platform, Airwallex, Marqeta, Adyen all play here. Regulatory ownership splits between platform and licence-holder.", None),
    ("Term", "Structuring (smurfing)",
     "Breaking large transactions into many small ones to evade reporting thresholds. A classic AML typology rule-based TM catches well; ML models sometimes miss because individual amounts look benign.", None),
    ("Term", "Source of Funds vs Source of Wealth",
     "SoF: where this specific transaction's money came from. SoW: how the customer accumulated their overall wealth over time. EDD typically requires both; many onboarding flows conflate the two.", None),
    ("Term", "False positive vs false negative trade-off",
     "Lower thresholds catch more true risk but burn analyst capacity. Higher thresholds save cost but increase misses. The right answer depends on regulatory appetite, not just cost.", None),
    ("Term", "JMLSG Guidance",
     "Joint Money Laundering Steering Group — UK industry guidance the FCA expects firms to follow. Updated regularly; Part II has sector-specific chapters (banking, e-money, money remittance, etc.). Citing the specific paragraph in an interview is gold-standard.",
     "https://www.jmlsg.org.uk/"),
    ("Term", "Travel Rule (FATF Recommendation 16)",
     "Originating institutions must include originator/beneficiary information with payment messages. Extended to virtual asset service providers in 2019. Implementation varies — UK/EU/US/MAS have different thresholds and timelines.",
     "https://www.fatf-gafi.org/en/publications/Virtualassets/Virtual-asset-service-providers.html"),
]


REFLECTIONS: List[FocusItem] = [
    ("Reflection", "Hardest call you made",
     "Think of one time you held an unpopular view in a senior stakeholder meeting. What was the call? Did you change your mind? Why or why not? Most senior interviews probe this exactly once.", None),
    ("Reflection", "Your strongest metric story",
     "Pick one outcome you delivered that you can defend with numbers (baseline, scope, method, result). Practise saying it in 60 seconds with the metric in the first sentence.", None),
    ("Reflection", "The thing you'd do differently",
     "Pick a project that didn't go to plan. What would you change with hindsight? Strong candidates separate decision quality from outcome quality — bad outcome doesn't mean bad call.", None),
    ("Reflection", "Your operating principles",
     "Without thinking too hard: how do you actually work week-to-week? Weekly deep-dives? Single-threaded ownership? Async-first? Knowing your own rhythm makes 'culture fit' answers honest, not performed.", None),
    ("Reflection", "What you cannot delegate",
     "Identify two or three things you currently do that nobody else in your org can. Then ask: is that a strength or a single point of failure? Senior interviews care about the answer.", None),
    ("Reflection", "Your regulator-facing instinct",
     "If a regulator asked you tomorrow to walk through a control you own, could you? In what order would you present the evidence? Most people freeze on this; preparation flips it into a quiet advantage.", None),
    ("Reflection", "The data point you trust least",
     "What metric in your current org do you mistrust most, and why? Strong product candidates can name one and explain the bias or measurement gap behind it.", None),
    ("Reflection", "Your bar for shipping",
     "Where exactly do you draw the line between 'safe to launch' and 'needs more time'? Articulating this — with one example each way — is one of the cleanest ways to show senior judgement.", None),
]


# Fallback only — used if the FCA RSS fetch fails
INDUSTRY_FALLBACK: List[FocusItem] = [
    ("Industry watch", "FCA Dear CEO letters",
     "FCA's Dear CEO letters are the clearest signal of where supervisory attention is sharpening. Read the latest one for payments, retail banking or wealth — whichever lines up with your applications. They tell you what the firm is being asked about, often months before the press picks it up.",
     "https://www.fca.org.uk/publications/letters"),
    ("Industry watch", "FATF mutual evaluations",
     "Every few years FATF publishes a mutual evaluation of a country's AML/CTF regime. Findings shape what UK firms get audited on for years afterwards. Citing specific deficiencies in interviews makes you sound informed without being preachy.",
     "https://www.fatf-gafi.org/en/the-fatf/news.html"),
    ("Industry watch", "Wolfsberg Group guidance",
     "Wolfsberg publishes correspondent-banking and AML guidance quietly adopted by the largest firms. Not legally binding but treated as best practice. The payment-transparency principles are essential for B2B payments roles.",
     "https://wolfsberg-group.org/publications"),
]


FCA_RSS_URL = "https://www.fca.org.uk/news/rss.xml"


# Memoise within a single process so build_focus_html and build_focus_text
# both return the same pick and only one entry is recorded in state.
_PROCESS_PICK: Optional[FocusItem] = None


def _category_for_hour(hour_utc: int) -> str:
    """Map UTC hour to category. 8/12/16/20 BST = 7/11/15/19 UTC."""
    if hour_utc in (7, 8):
        return "Quote"
    if hour_utc in (11, 12):
        return "Term"
    if hour_utc in (15, 16):
        return "Reflection"
    if hour_utc in (19, 20):
        return "Industry"
    return "Quote"


def _state_path() -> Path:
    return config.DIGEST_DIR / "focus_state.json"


def _load_state() -> dict:
    path = _state_path()
    if not path.exists():
        return {"recent": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"recent": []}


def _save_state(state: dict) -> None:
    try:
        recent = state.get("recent", [])
        state["recent"] = recent[-30:]
        _state_path().write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception:
        pass


def _pick_unseen(pool: List[FocusItem], recent_keys: List[str]) -> FocusItem:
    fresh = [item for item in pool if _key(item) not in recent_keys]
    if not fresh:
        fresh = pool
    return fresh[0] if len(fresh) == 1 else fresh[hash(",".join(recent_keys[-3:])) % len(fresh)]


def _key(item: FocusItem) -> str:
    cat, head, _, _ = item
    return f"{cat}::{head}"


def _fetch_fca_industry(recent_keys: List[str]) -> Optional[FocusItem]:
    try:
        import feedparser
        import requests
        # feedparser's built-in fetcher fails against fca.org.uk; use requests
        resp = requests.get(
            FCA_RSS_URL,
            headers={"User-Agent": "Mozilla/5.0 (compatible; job-digest/1.0)"},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        feed = feedparser.parse(resp.content)
        entries = list(feed.entries or [])[:15]
        for entry in entries:
            title = (entry.get("title") or "").strip()
            link = (entry.get("link") or "").strip()
            summary = (entry.get("summary") or entry.get("description") or "").strip()
            published = entry.get("published") or ""
            key = f"Industry::FCA::{link or title}"
            if not title or not link:
                continue
            if key in recent_keys:
                continue
            summary = " ".join(summary.split())
            if len(summary) > 360:
                summary = summary[:357].rstrip() + "..."
            head = title if not published else f"{title}  ({published[:16]})"
            return ("Industry watch (FCA)", head, summary, link)
        return None
    except Exception:
        return None


def pick_focus(now: Optional[datetime] = None) -> FocusItem:
    global _PROCESS_PICK
    if _PROCESS_PICK is not None:
        return _PROCESS_PICK
    if now is None:
        now = datetime.now(tz=timezone.utc)
    category = _category_for_hour(now.hour)
    state = _load_state()
    recent_keys = state.get("recent", [])

    item: Optional[FocusItem] = None
    if category == "Industry":
        item = _fetch_fca_industry(recent_keys)
        if item is None:
            item = _pick_unseen(INDUSTRY_FALLBACK, recent_keys)
    elif category == "Term":
        item = _pick_unseen(TERMS, recent_keys)
    elif category == "Reflection":
        item = _pick_unseen(REFLECTIONS, recent_keys)
    else:
        item = _pick_unseen(QUOTES, recent_keys)

    recent_keys.append(_key(item))
    state["recent"] = recent_keys
    _save_state(state)
    _PROCESS_PICK = item
    return item


def build_focus_html(now: Optional[datetime] = None) -> str:
    category, headline, body, url = pick_focus(now)
    link_html = ""
    if url:
        link_html = (
            f"<div style='margin-top:8px;'>"
            f"<a href='{escape(url)}' style='color:#92400E; text-decoration:underline; font-weight:bold;'>"
            f"Read more &rarr;</a></div>"
        )
    return (
        "<div style='background:#FFFBEB; border:1px solid #FDE68A; padding:12px; "
        "border-radius:8px; margin-bottom:14px; font-size:14px; color:#78350F;'>"
        f"<div style='text-transform:uppercase; letter-spacing:0.06em; font-size:11px; "
        f"font-weight:bold; color:#92400E; margin-bottom:4px;'>{escape(category)}</div>"
        f"<div style='font-weight:bold; color:#451A03; margin-bottom:6px;'>{escape(headline)}</div>"
        f"<div style='color:#78350F; line-height:1.5;'>{escape(body)}</div>"
        f"{link_html}"
        "</div>"
    )


def build_focus_text(now: Optional[datetime] = None) -> str:
    category, headline, body, url = pick_focus(now)
    text = f"[{category}] {headline} — {body}"
    if url:
        text += f"\n  Link: {url}"
    return text
