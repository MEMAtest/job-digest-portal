const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { generateTailoredCvSections } = require("./_cv_generation");
const {
  MASTER_CV_SCHEMA,
  getDefaultBaseCvSections,
  getResolvedCvSections,
  normalizeTailoredCvSections,
  validateCvVariant,
} = require("./_cv_schema");

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

const DEFAULT_BASE_CV_SECTIONS = getDefaultBaseCvSections();

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const buildWhyThisRole = (job) => {
  const parts = [
    cleanText(job.tailored_summary),
    cleanText(job.why_fit),
    cleanText(job.role_summary),
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 3000);
};

const buildWhyThisCompany = (job) => {
  const parts = [cleanText(job.company_insights), cleanText(job.match_notes)].filter(Boolean);
  if (parts.length) return parts.join("\n\n").slice(0, 2000);
  if (job.company) {
    return `I am interested in ${job.company} because the role aligns with my background in onboarding, KYC, screening and regulated product delivery.`;
  }
  return "";
};

const buildCoverLetterFallback = (job, profile) => {
  const whyRole = buildWhyThisRole(job);
  const whyCompany = buildWhyThisCompany(job);
  return [
    `Dear ${job.company || "Hiring Team"},`,
    "",
    `I am applying for the ${job.role || "role"} role${job.company ? ` at ${job.company}` : ""}.`,
    whyRole,
    whyCompany,
    "",
    `Kind regards,`,
    profile.fullName || DEFAULT_APPLICATION_PROFILE.fullName,
  ]
    .filter(Boolean)
    .join("\n");
};

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

    let tailoredSections = normalizeTailoredCvSections(job.tailored_cv_sections || {});
    if (!tailoredSections || !Object.keys(tailoredSections).length) {
      tailoredSections = await generateTailoredCvSections({
        db,
        job,
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    const profileDoc = await db.collection("settings").doc("application_profile").get();
    const cvSettingsDoc = await db.collection("cv_settings").doc("base_cv").get();
    const applicationProfile = {
      ...DEFAULT_APPLICATION_PROFILE,
      ...(profileDoc.exists ? profileDoc.data() : {}),
    };
    const baseCvSections = {
      ...DEFAULT_BASE_CV_SECTIONS,
      ...(cvSettingsDoc.exists ? cvSettingsDoc.data() : {}),
    };
    const resolvedCvSections = getResolvedCvSections({
      baseSections: baseCvSections,
      tailoredSections: tailoredSections,
    });
    const cvValidation = validateCvVariant({
      baseSections: baseCvSections,
      tailoredSections: tailoredSections,
    });

    const answers = {
      fullName: applicationProfile.fullName,
      email: applicationProfile.email,
      phone: applicationProfile.phone,
      location: applicationProfile.location,
      linkedinUrl: applicationProfile.linkedinUrl || "",
      portfolioUrl: applicationProfile.portfolioUrl || "",
      rightToWorkUk: applicationProfile.rightToWorkUk || "Yes",
      noticePeriod: applicationProfile.noticePeriod || "",
      salaryExpectation: applicationProfile.salaryExpectation || "",
      whyThisRole: buildWhyThisRole(job),
      whyThisCompany: buildWhyThisCompany(job),
      coverLetter: job.cover_letter || buildCoverLetterFallback(job, applicationProfile),
    };

    const generatedAt = new Date().toISOString();
    const applicationPack = {
      ats_family: atsFamily,
      generated_at: generatedAt,
      cv_ready: true,
      answer_fields: Object.keys(answers).filter((key) => cleanText(answers[key])),
      master_cv_version: MASTER_CV_SCHEMA.version,
    };

    await db.collection("jobs").doc(jobId).update({
      tailored_cv_sections: tailoredSections,
      cv_generated_at: generatedAt,
      application_pack: applicationPack,
      application_pack_generated_at: generatedAt,
      application_answers: answers,
      apply_assistant_status: "pack_ready",
      updated_at: generatedAt,
    });

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
      },
    });
  } catch (error) {
    console.error("generate-application-pack error:", error);
    return withCors({ error: error.message || "Application pack generation failed" }, 500);
  }
};
