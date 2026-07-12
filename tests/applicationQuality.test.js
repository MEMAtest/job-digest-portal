import { describe, expect, test } from "vitest";
import qualityModule from "../netlify/functions/_application_quality.js";
import cvSchemaModule from "../netlify/functions/_cv_schema.js";

const { buildApplicationAnswers, validateApplicationAnswers } = qualityModule;
const { getDefaultBaseCvSections } = cvSchemaModule;

const profile = {
  fullName: "Ade Omosanya",
  email: "ademolaomosanya@gmail.com",
  phone: "07920497486",
  location: "London, United Kingdom",
  rightToWorkUk: "Yes",
};

const job = {
  role: "Product Manager - AML",
  company: "Example Bank",
  key_requirements: [
    "AML and KYC product ownership",
    "Cross-functional delivery with engineering",
    "Screening APIs and regulated onboarding",
  ],
};

const tailoredSections = {
  summary:
    "Senior Product Manager across regulated fintech, digital banking, onboarding, KYC, screening and financial crime platforms. Owns roadmaps and delivery with engineering across complex regulated environments.",
  key_achievements: [
    "Standardised onboarding, KYC and screening across 30+ jurisdictions by defining one global product model across Enate, Fenergo and Napier",
    "Reduced onboarding cycle time by 20% and client outreach touchpoints by 30% through journey redesign and improved data capture",
    "Delivered 20% onboarding conversion uplift and 38% fewer unnecessary screening reviews across Spain, Greece and Germany",
  ],
};

describe("application answer quality", () => {
  test("builds a role-specific, evidence-traceable application pack", () => {
    const answers = buildApplicationAnswers({ job, profile, tailoredSections });
    const validation = validateApplicationAnswers({ job, profile, answers, tailoredSections });

    expect(validation.ok).toBe(true);
    expect(validation.quality_score).toBe(100);
    expect(validation.metrics.cover_letter_evidence_matches).toBe(3);
    expect(answers.coverLetter).toContain(job.role);
    expect(answers.coverLetter).toContain(job.company);
  });

  test("passes with the real master CV evidence library", () => {
    const masterSections = { ...getDefaultBaseCvSections(), quality_status: "accepted" };
    const answers = buildApplicationAnswers({ job, profile, tailoredSections: masterSections });
    const validation = validateApplicationAnswers({ job, profile, answers, tailoredSections: masterSections });

    expect(validation.ok).toBe(true);
    expect(validation.quality_score).toBe(100);
    expect(validation.metrics.cover_letter_evidence_matches).toBeGreaterThanOrEqual(2);
  });

  test("rejects internal coaching language and third-person copy", () => {
    const answers = buildApplicationAnswers({ job, profile, tailoredSections });
    answers.whyThisRole = "Ade's strongest angle is regulated product delivery. Match should be positioned around AML.";
    const validation = validateApplicationAnswers({ job, profile, answers, tailoredSections });

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("third-person candidate wording"))).toBe(true);
    expect(validation.errors.some((error) => error.includes("internal positioning guidance"))).toBe(true);
  });

  test("rejects identity fields that differ from the approved profile", () => {
    const answers = buildApplicationAnswers({ job, profile, tailoredSections });
    answers.email = "wrong@example.com";
    const validation = validateApplicationAnswers({ job, profile, answers, tailoredSections });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("Application field does not match the approved profile: email");
  });

  test("rejects narratives that are not traceable to accepted CV evidence", () => {
    const answers = buildApplicationAnswers({ job, profile, tailoredSections });
    answers.coverLetter = answers.coverLetter
      .split("\n")
      .filter((line) => !line.startsWith("- "))
      .join("\n");
    const validation = validateApplicationAnswers({ job, profile, answers, tailoredSections });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("Cover letter is not traceable to at least two accepted CV achievements");
  });
});
