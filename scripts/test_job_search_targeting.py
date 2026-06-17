"""Regression checks for Ade's fresh-first financial-crime job targeting."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.job_digest.scoring import assess_fit, classify_target_role_bucket  # noqa: E402
from scripts.job_digest.runner import min_score_for_fit  # noqa: E402


def _fit(title: str, summary: str = "", company: str = "TestCo", source_family: str = "JobBoard") -> dict:
    return assess_fit(f"{title} {summary}", company, source_family, "Test")


def test_core_product_roles_rank_strong() -> None:
    fit = _fit(
        "Senior Product Manager Financial Crime KYC/KYB",
        "Own onboarding controls, customer risk, sanctions screening workflows and RegTech automation.",
    )
    assert fit["role_bucket"] in {"core_product", "screening_sanctions_product", "clm_product_owner", "regtech_product"}
    assert fit["fit_verdict"] == "STRONG"
    assert fit["score"] >= min_score_for_fit(fit, "JobBoard", "Test")


def test_product_compliance_roles_are_apply_first_material() -> None:
    fit = _fit(
        "Senior Product Compliance Manager - KYC & Onboarding",
        "Work with product and engineering to design KYC controls, testing, automation and workflow improvements.",
    )
    assert fit["role_bucket"] == "product_compliance"
    assert fit["score"] >= 78


def test_screening_and_clm_product_roles_are_core_lanes() -> None:
    screening = _fit(
        "Product Manager - Sanctions Screening",
        "Own name screening, payment screening, false positives, controls and case management automation.",
    )
    clm = _fit(
        "Fenergo Product Owner",
        "Lead CLM, KYC onboarding workflow, FenX implementation and client lifecycle controls.",
    )
    assert screening["role_bucket"] == "screening_sanctions_product"
    assert clm["role_bucket"] == "clm_product_owner"
    assert screening["score"] >= 78
    assert clm["score"] >= 78


def test_part_four_roles_are_included_when_systems_controls_or_transformation_led() -> None:
    head = _fit(
        "Head of KYC Transformation",
        "Own onboarding operating model, controls, workflow automation and platform change across 1LOD.",
    )
    senior_manager = _fit(
        "Financial Crime Senior Manager",
        "Lead systems remediation, workflow controls, dashboards, TOM and automation for AML operations.",
    )
    assert head["role_bucket"] == "selective_transformation"
    assert senior_manager["role_bucket"] == "selective_transformation"
    assert head["score"] >= min_score_for_fit(head, "JobBoard", "Test")
    assert senior_manager["score"] >= min_score_for_fit(senior_manager, "JobBoard", "Test")


def test_contract_ba_roles_get_contract_bucket() -> None:
    fit = _fit(
        "CLM Business Analyst Inside IR35",
        "Contract role covering Fenergo, KYC onboarding, CDD, controls and client lifecycle workflow.",
    )
    assert fit["role_bucket"] == "contract_ba_transformation"
    assert fit["score"] >= min_score_for_fit(fit, "JobBoard", "Test")


def test_generic_product_and_pure_analyst_are_demoted() -> None:
    generic = _fit("Product Manager", "Own generic app roadmap and growth features.")
    analyst = _fit("KYC Analyst", "Review customer files, investigate alerts and perform BAU remediation.")
    assert generic["role_bucket"] == "generic_product"
    assert generic["score"] < min_score_for_fit(generic, "JobBoard", "Test")
    assert analyst["role_bucket"] != "core_product"
    assert analyst["score"] < 70


def test_bucket_classifier_is_stable_for_exact_search_lanes() -> None:
    assert classify_target_role_bucket("Payments Compliance Product Manager onboarding controls") == "product_compliance"
    assert classify_target_role_bucket("Payment Risk Product Manager merchant onboarding KYC") == "core_product"
    assert classify_target_role_bucket("Client Onboarding Transformation Lead KYC controls workflow") == "selective_transformation"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("job search targeting tests passed")
