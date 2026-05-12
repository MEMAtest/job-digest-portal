"""Rotating daily-focus block shown above the digest table.

Picks one item per day from a pool that mixes:
 - inspirational quotes
 - fincrime / regtech terms worth knowing
 - interview reflection prompts
 - industry observations

Deterministic by date so the same item shows across the four daily fires,
but rotates day to day. No external API; no LLM call; safe in CI.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from typing import List, Tuple


# Each entry: (category_label, headline, body)
FOCUS_POOL: List[Tuple[str, str, str]] = [
    # Inspirational / career-stamina quotes
    ("Quote",
     "Alan Kay",
     "The best way to predict the future is to invent it."),
    ("Quote",
     "Warren Buffett",
     "It takes 20 years to build a reputation and five minutes to ruin it. If you think about that, you'll do things differently."),
    ("Quote",
     "Marcus Aurelius",
     "You have power over your mind, not outside events. Realise this, and you will find strength."),
    ("Quote",
     "Jeff Bezos",
     "Most decisions should probably be made with somewhere around 70% of the information you wish you had. If you wait for 90%, in most cases, you're probably being slow."),
    ("Quote",
     "Maya Angelou",
     "People will forget what you said, people will forget what you did, but people will never forget how you made them feel."),
    ("Quote",
     "Reid Hoffman",
     "An entrepreneur is someone who jumps off a cliff and builds a plane on the way down."),
    ("Quote",
     "Naval Ravikant",
     "Play long-term games with long-term people. All returns in life, whether in wealth, relationships, or knowledge, come from compound interest."),
    ("Quote",
     "Charlie Munger",
     "The big money is not in the buying or the selling, but in the waiting."),
    ("Quote",
     "Stewart Brand",
     "Information wants to be free. Information also wants to be expensive. That tension will not go away."),

    # FinCrime / RegTech terms
    ("Term of the day",
     "Perpetual KYC (pKYC)",
     "A risk-based model where customer due diligence is refreshed by event triggers (transaction patterns, sanctions list changes, beneficial-ownership updates) rather than fixed periodic reviews. The FCA, MAS and DNB have all signalled support; the trade-off is operational tooling maturity."),
    ("Term of the day",
     "Three Lines of Defence",
     "Industry-standard governance model. 1st line: the business owns the risk and runs the controls. 2nd line: independent compliance/risk function challenges and oversees. 3rd line: internal audit gives assurance to the board. Product Compliance roles often sit at 1.5 — first line but with significant judgement."),
    ("Term of the day",
     "Alert-to-SAR ratio",
     "The percentage of transaction-monitoring alerts that ultimately convert to Suspicious Activity Reports. A low ratio (under ~5%) flags noisy rules; an unusually high ratio can flag overly narrow rules that miss real activity. Always pair with recall (what was missed)."),
    ("Term of the day",
     "Model Risk Management",
     "Framework for managing risks from machine-learning and statistical models used in fincrime, fraud and credit. Covers development controls, independent validation, explainability, monitoring for drift, and break-glass procedures. FCA SS1/23 in the UK is the live anchor."),
    ("Term of the day",
     "Risk-Based Approach (RBA)",
     "The FATF principle that AML/CFT controls should be proportionate to assessed risk. In product terms: don't apply uniform friction; segment customers by risk and adjust onboarding, monitoring intensity, and review cadence accordingly."),
    ("Term of the day",
     "Embedded Finance",
     "Non-financial platforms (marketplaces, SaaS, gig apps) offering banking, payments, lending or cards through APIs from a regulated provider. Wise Platform, Airwallex, Marqeta and Adyen all play here. Regulatory ownership splits between the platform and the licence-holder."),
    ("Term of the day",
     "Structuring (smurfing)",
     "Breaking large transactions into many small ones to evade reporting thresholds. A classic AML typology that rule-based TM can detect well but ML models sometimes miss because the small individual amounts look benign."),
    ("Term of the day",
     "Source of Funds vs Source of Wealth",
     "SoF: where this specific transaction's money came from. SoW: how the customer accumulated their overall wealth over time. EDD typically requires both; lots of onboarding flows confuse the two."),
    ("Term of the day",
     "False positive vs false negative trade-off",
     "In screening and TM, lowering thresholds catches more true risk but burns analyst capacity on noise. Raising thresholds saves cost but increases missed activity. The right answer depends on regulatory appetite, not just cost."),

    # Interview reflection prompts
    ("Reflection",
     "Hardest call you made",
     "Think of one time you held an unpopular view in a senior stakeholder meeting. What was the call? Did you change your mind? Why or why not? — most senior interviews probe this exactly once."),
    ("Reflection",
     "Your strongest metric story",
     "Pick one outcome you delivered that you can defend with numbers (baseline, scope, method, result). Practise saying it in 60 seconds with the metric in the first sentence."),
    ("Reflection",
     "The thing you'd do differently",
     "Pick a project that didn't go to plan. What would you change with hindsight? Strong candidates separate decision quality from outcome quality — bad outcome doesn't mean bad call."),
    ("Reflection",
     "Your operating principles",
     "Without thinking too hard: how do you actually work week-to-week? Weekly deep-dives? Single-threaded ownership? Async-first? Knowing your own rhythm makes 'culture fit' answers honest, not performed."),
    ("Reflection",
     "What you cannot delegate",
     "Identify two or three things you currently do that nobody else in your org can. Then ask: is that a strength or a single point of failure? Senior interviews care about the answer."),
    ("Reflection",
     "Your regulator-facing instinct",
     "If a regulator asked you tomorrow to walk through a control you own, could you? In what order would you present the evidence? Most people freeze on this; preparation flips it into a quiet advantage."),

    # Industry observations
    ("Industry watch",
     "FCA Dear CEO letters",
     "FCA's Dear CEO letters are the clearest signal of where supervisory attention is sharpening. Read the latest one for payments, retail banking or wealth — whichever lines up with your applications. They tell you what the firm is being asked about, often months before the press picks it up."),
    ("Industry watch",
     "FATF mutual evaluations",
     "Every few years FATF publishes a mutual evaluation of a country's AML/CTF regime. The UK's most recent was in 2018 (next due soon). The findings shape what UK firms get audited on. Cite specific deficiencies in interviews to sound informed."),
    ("Industry watch",
     "Wolfsberg Group guidance",
     "Wolfsberg publishes correspondent-banking and AML guidance that's quietly adopted by the largest firms. Not legally binding, but treated as best practice. Wolfsberg's payment-transparency principles are essential reading for B2B payments roles."),
    ("Industry watch",
     "The shift to ML in TM",
     "Most Tier 1s are running ML TM models in parallel with rule-based scenarios; few have fully retired the scenarios. Regulators want explainability + model validation + clear retirement criteria. The technical conversation is now governance, not algorithm choice."),
]


def pick_focus(now: datetime | None = None) -> Tuple[str, str, str]:
    """Pick today's item deterministically by date, in UTC.

    Same item across the day (08/12/16/20 fires), rotates the next day.
    """
    if now is None:
        now = datetime.now(tz=timezone.utc)
    day_of_year = now.timetuple().tm_yday
    year = now.year
    idx = (day_of_year + (year % 10)) % len(FOCUS_POOL)
    return FOCUS_POOL[idx]


def build_focus_html(now: datetime | None = None) -> str:
    category, headline, body = pick_focus(now)
    return (
        "<div style='background:#FFFBEB; border:1px solid #FDE68A; padding:12px; "
        "border-radius:8px; margin-bottom:14px; font-size:14px; color:#78350F;'>"
        f"<div style='text-transform:uppercase; letter-spacing:0.06em; font-size:11px; "
        f"font-weight:bold; color:#92400E; margin-bottom:4px;'>{escape(category)}</div>"
        f"<div style='font-weight:bold; color:#451A03; margin-bottom:6px;'>{escape(headline)}</div>"
        f"<div style='color:#78350F; line-height:1.5;'>{escape(body)}</div>"
        "</div>"
    )


def build_focus_text(now: datetime | None = None) -> str:
    category, headline, body = pick_focus(now)
    return f"[{category}] {headline} — {body}"
