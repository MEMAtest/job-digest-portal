import { describe, expect, test } from "vitest";
import qualityModule from "../netlify/functions/_auto_apply_quality.js";

const {
  assessApplicationPackQuality,
  buildAtsKeywordCoverage,
} = qualityModule;

const strongSections = {
  summary: "Product owner for regulated banking platforms, KYC, AML and payments",
  key_achievements: [
    "Owned cross-functional delivery and control design across financial services",
    "Integrated screening APIs and improved onboarding conversion",
  ],
  product_engineering_competencies: ["Roadmap ownership", "Agile delivery", "API integrations"],
};

describe("auto-apply ATS quality gate", () => {
  test("measures meaningful requirement coverage across all CV sections", () => {
    const coverage = buildAtsKeywordCoverage(
      {
        key_requirements: [
          "Payments, banking, or transaction-platform product experience",
          "Strong control design and cross-functional delivery discipline",
          "KYC and AML screening API integrations",
        ],
      },
      strongSections,
    );

    expect(coverage.score).toBe(100);
    expect(coverage.missing).toEqual([]);
  });

  test("holds a pack whose ATS coverage is below the configured threshold", () => {
    const result = assessApplicationPackQuality({
      job: { key_requirements: ["KYC and AML", "Python and SQL machine learning"] },
      pack: {
        tailoredCvSections: { ...strongSections, quality_status: "accepted" },
        cvValidation: { ok: true, decision: "accept", quality_score: 96 },
        applicationValidation: { ok: true, quality_score: 95 },
      },
      minAtsCoverage: 80,
      minCvQualityScore: 90,
    });

    expect(result.passed).toBe(false);
    expect(result.atsCoverage.score).toBe(50);
    expect(result.reasons).toContain("ATS coverage 50% is below 80%");
  });

  test("passes only an accepted, validated, high-quality pack", () => {
    const result = assessApplicationPackQuality({
      job: { key_requirements: ["KYC and AML", "Cross-functional product delivery"] },
      pack: {
        tailoredCvSections: { ...strongSections, quality_status: "accepted" },
        cvValidation: { ok: true, decision: "accept", quality_score: 96 },
        applicationValidation: { ok: true, quality_score: 95 },
      },
      minAtsCoverage: 80,
      minCvQualityScore: 90,
    });

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("holds a pack whose application answers fail validation", () => {
    const result = assessApplicationPackQuality({
      job: { key_requirements: ["KYC and AML"] },
      pack: {
        tailoredCvSections: { ...strongSections, quality_status: "accepted" },
        cvValidation: { ok: true, decision: "accept", quality_score: 96 },
        applicationValidation: { ok: false, quality_score: 60 },
      },
      minApplicationQualityScore: 90,
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("Application answers did not pass validation");
    expect(result.reasons).toContain("Application quality 60 is below 90");
  });
});
