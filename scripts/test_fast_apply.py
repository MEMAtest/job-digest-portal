"""Standalone regression checks for fresh/scarcity ranking + hot lane.

No pytest dependency (the repo has no Python test runner) — run directly:

    python scripts/test_fast_apply.py

Exits non-zero on the first failed assertion.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.job_digest.models import JobRecord  # noqa: E402
from scripts.job_digest import utils  # noqa: E402


def _mk(fit, posted="", posted_date="", applicants="", ats="greenhouse",
        link="https://boards.greenhouse.io/acme/jobs/1"):
    return JobRecord(
        role="R", company="C", location="L", link=link, posted=posted, source="S",
        fit_score=fit, preference_match="", why_fit="", cv_gap="", notes="",
        posted_raw=posted, posted_date=posted_date, applicant_count=applicants, ats_family=ats,
    )


def test_priority_score():
    fresh = _mk(78, posted="1 hour ago", applicants="3 applicants")
    stale = _mk(88, posted="3 days ago")
    nodate = _mk(90, posted="")                       # unknown freshness
    capped = _mk(80, posted="30 minutes ago", applicants="2 applicants")
    noisy = _mk(82, posted="2 hours ago", applicants="Over 100 applicants")

    for r in (fresh, stale, nodate, capped, noisy):
        utils.compute_priority_score(r)

    assert fresh.priority_score == 96.0, fresh.priority_score          # 78 + 12 + 8 (cap 18 not hit)
    assert stale.priority_score == 88.0, stale.priority_score          # no boost
    assert nodate.priority_score == 90.0, nodate.priority_score        # missing freshness != penalty
    assert capped.priority_score == 98.0, capped.priority_score        # 80 + min(12+8, 18)
    assert noisy.priority_score == 94.0, noisy.priority_score          # 82 + 12 (>100 applicants -> +0)
    assert fresh.priority_score > stale.priority_score                 # fresh near-miss beats stale strong-fit
    assert noisy.applicant_bucket == "saturated"


def test_hot_lane():
    fresh = _mk(78, posted="1 hour ago", applicants="3 applicants")
    stale = _mk(88, posted="3 days ago")
    nodate = _mk(90, posted="")
    capped = _mk(80, posted="30 minutes ago", applicants="2 applicants")
    crowded = _mk(85, posted="1 hour ago", applicants="40 applicants")   # too many applicants
    wrong_ats = _mk(90, posted="1 hour ago", ats="workday",
                    link="https://x.wd1.myworkdayjobs.com/job/1")
    for r in (fresh, stale, nodate, capped, crowded, wrong_ats):
        utils.compute_priority_score(r)

    hot = utils.select_hot_lane([fresh, stale, nodate, capped, crowded, wrong_ats])
    assert capped in hot and fresh in hot
    assert stale not in hot and nodate not in hot      # not fresh enough / unknown freshness
    assert crowded not in hot                          # >25 applicants
    assert wrong_ats not in hot                        # unsupported ATS
    assert hot[0] is capped                             # highest priority first (98 > 96)


def test_hot_scan_lane():
    # Scanner lane (require_fresh=False): timestamp-less ATS roles must be
    # INCLUDED (feeds often omit a posted time), only clearly-stale known dates
    # dropped. Uses HOT_SCAN_MIN_FIT (72) so strong-but-not-perfect roles ping.
    notime = _mk(74, posted="", applicants="2 applicants")           # no timestamp, fit 74
    stale = _mk(90, posted="3 weeks ago")                            # known + very old
    weak = _mk(60, posted="")                                        # below scanner threshold
    fresh = _mk(80, posted="1 hour ago")
    for r in (notime, stale, weak, fresh):
        utils.compute_priority_score(r)

    scan = utils.select_hot_lane(
        [notime, stale, weak, fresh], min_fit=72, limit=None, require_fresh=False
    )
    assert notime in scan, "timestamp-less role must be included in the scanner lane"
    assert fresh in scan
    assert weak not in scan, "below 72 fit excluded"
    assert stale not in scan, "known date older than 7d dropped"

    # The digest lane (require_fresh=True) must STILL exclude the timestamp-less one.
    digest = utils.select_hot_lane([notime, fresh])
    assert notime not in digest and fresh in digest


if __name__ == "__main__":
    test_priority_score()
    test_hot_lane()
    test_hot_scan_lane()
    print("OK: fast-apply ranking + hot-lane + hot-scan tests passed")
