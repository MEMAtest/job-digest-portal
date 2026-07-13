const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { generateTailoredCvBundle, hasCvGenerationProvider, loadBaseCvSections } = require("./_cv_generation");
const {
  MASTER_CV_SCHEMA,
  getResolvedCvSections,
  normalizeTailoredCvSections,
  validateCvVariant,
  finalizeTailoredCvSections,
} = require("./_cv_schema");
const { buildApplicationAnswers, validateApplicationAnswers } = require("./_application_quality");
const { assessApplicationPackQuality } = require("./_auto_apply_quality");

const SUPPORTED_ATS = new Set(["Greenhouse", "Lever", "Ashby", "Workable"]);

const DEFAULT_APPLICATION_PROFILE = {
  fullName: "Ade Omosanya",
  email: "ademolaomosanya@gmail.com",
  phone: "07920497486",
  location: "London, United Kingdom",
  linkedinUrl: "",
  portfolioUrl: "",
  rightToWorkUk: "Yes",
  noticePeriod: "",
  salaryExpectation: "",
};

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const inferAtsFamily = (job) => {
  const ats = String(job.ats_family || job.source || "").trim();
  return SUPPORTED_ATS.has(ats) ? ats : "";
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const jobId = payload.jobId;
    if (!jobId) {
      return withCors({ error: "jobId required" }, 400);
    }

    const db = getFirestore();
    const jobDoc = await db.collection("jobs").doc(jobId).get();
    if (!jobDoc.exists) {
      return withCors({ error: "Job not found" }, 404);
    }

    const job = jobDoc.data() || {};
    const atsFamily = inferAtsFamily(job);
    if (!atsFamily) {
      return withCors({ error: "Apply Assistant supports Greenhouse, Lever, Ashby, and Workable only" }, 400);
    }

    const baseCvSections = await loadBaseCvSections(db);
    let tailoredSections = normalizeTailoredCvSections(job.tailored_cv_sections || {});
    let cvValidation = validateCvVariant({
      baseSections: baseCvSections,
      tailoredSections,
    });
    if (!tailoredSections || !Object.keys(tailoredSections).length) {
      if (!hasCvGenerationProvider()) {
        return withCors({ error: "No CV generation provider configured" }, 500);
      }
      const generationResult = await generateTailoredCvBundle({
        db,
        job,
        apiKey: process.env.OPENAI_API_KEY,
      });
      tailoredSections = generationResult.sections;
      cvValidation = generationResult.validation;
    } else {
      const finalized = finalizeTailoredCvSections({
        baseSections: baseCvSections,
        tailoredSections,
        job,
        providerName: tailoredSections.generated_by_provider || "",
        styleProfileId: tailoredSections.style_profile || "master_default",
      });
      tailoredSections = finalized.sections;
      cvValidation = finalized.validation;
    }

    const profileDoc = await db.collection("settings").doc("application_profile").get();
    const applicationProfile = {
      ...DEFAULT_APPLICATION_PROFILE,
      ...(profileDoc.exists ? profileDoc.data() : {}),
    };
    const resolvedCvSections = getResolvedCvSections({
      baseSections: baseCvSections,
      tailoredSections: tailoredSections,
    });
    cvValidation = validateCvVariant({
      baseSections: baseCvSections,
      tailoredSections: tailoredSections,
    });

    const answers = buildApplicationAnswers({
      job,
      profile: applicationProfile,
      tailoredSections,
    });
    const applicationValidation = validateApplicationAnswers({
      job,
      profile: applicationProfile,
      answers,
      tailoredSections,
    });

    const prefsDoc = await db.collection("settings").doc("auto_apply_preferences").get();
    const prefs = prefsDoc.exists ? prefsDoc.data() || {} : {};
    const qualityGate = assessApplicationPackQuality({
      job,
      pack: {
        tailoredCvSections: tailoredSections,
        resolvedCvSections,
        cvValidation,
        applicationValidation,
      },
      minAtsCoverage: Number(prefs.min_ats_coverage ?? 80),
      minCvQualityScore: Number(prefs.min_cv_quality_score ?? 90),
      minApplicationQualityScore: Number(prefs.min_application_quality_score ?? 90),
      requireAtsCoverage: prefs.require_ats_coverage !== false,
    });

    const generatedAt = new Date().toISOString();
    const applicationPack = {
      ats_family: atsFamily,
      generated_at: generatedAt,
      cv_ready: true,
      answer_fields: Object.keys(answers).filter((key) => cleanText(answers[key])),
      master_cv_version: MASTER_CV_SCHEMA.version,
      application_quality_score: applicationValidation.quality_score,
    };

    const checkedAt = new Date().toISOString();
    const qualityGateData = {
      passed: qualityGate.passed,
      reasons: qualityGate.reasons,
      cv_quality_score: qualityGate.cvQualityScore,
      cv_quality_status: qualityGate.cvQualityStatus,
      application_quality_score: qualityGate.applicationQualityScore,
      ats_coverage_score: qualityGate.atsCoverage?.score ?? null,
      checked_at: checkedAt,
    };

    await db.collection("jobs").doc(jobId).update({
      tailored_cv_sections: tailoredSections,
      cv_validation: cvValidation,
      cv_role_family: tailoredSections.role_family || "",
      cv_generated_at: generatedAt,
      application_pack: applicationPack,
      application_pack_generated_at: generatedAt,
      application_answers: answers,
      application_validation: applicationValidation,
      ats_keyword_coverage: qualityGate.atsCoverage,
      auto_apply_quality_gate: qualityGateData,
      apply_assistant_status: qualityGate.passed ? "pack_ready" : "quality_hold",
      updated_at: generatedAt,
    });

    if (!qualityGate.passed) {
      return withCors(
        {
          error: "Application pack failed the quality gate",
          reasons: qualityGate.reasons,
          applicationValidation,
        },
        422,
      );
    }

    return withCors({
      success: true,
      atsFamily,
      pack: {
        applicationPack,
        answers,
        tailoredCvSections: tailoredSections,
        baseCvSections,
        resolvedCvSections,
        masterCv: MASTER_CV_SCHEMA,
        cvValidation,
        applicationValidation,
        qualityGate: qualityGateData,
        atsKeywordCoverage: qualityGate.atsCoverage,
      },
    });
  } catch (error) {
    console.error("generate-application-pack error:", error);
    return withCors({ error: error.message || "Application pack generation failed" }, 500);
  }
};
