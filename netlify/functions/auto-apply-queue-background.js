const { getFirestore } = require("./_firebase");
const { generateTailoredCvBundle, hasCvGenerationProvider, loadBaseCvSections } = require("./_cv_generation");
const {
  MASTER_CV_SCHEMA,
  getResolvedCvSections,
  normalizeTailoredCvSections,
  validateCvVariant,
  finalizeTailoredCvSections,
} = require("./_cv_schema");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

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

const SUPPORTED_ATS = new Set(["Greenhouse", "Lever", "Ashby", "Workable"]);

const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const buildWhyThisRole = (job) => {
  const parts = [cleanText(job.tailored_summary), cleanText(job.why_fit), cleanText(job.role_summary)].filter(Boolean);
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

const generateToken = (jobId) => {
  const secret = process.env.AUTO_APPLY_HMAC_SECRET;
  if (!secret) throw new Error("AUTO_APPLY_HMAC_SECRET not set");
  return crypto.createHmac("sha256", secret).update(jobId).digest("hex");
};

const buildEmailHtml = (job, pack, token, siteUrl) => {
  const answers = pack.answers || {};
  const tailoredSections = pack.tailoredCvSections || {};
  const summary = cleanText(tailoredSections.summary || tailoredSections.professional_summary || "");
  const achievements = Array.isArray(tailoredSections.key_achievements)
    ? tailoredSections.key_achievements.slice(0, 3)
    : Array.isArray(tailoredSections.achievements)
    ? tailoredSections.achievements.slice(0, 3)
    : [];

  const achievementBullets = achievements.length
    ? achievements.map((a) => `<li style="margin-bottom:6px;">${escHtml(String(a))}</li>`).join("")
    : "<li>See attached CV for full achievements</li>";

  const goUrl = `${siteUrl}/.netlify/functions/auto-apply-decision?jobId=${encodeURIComponent(job.id)}&token=${token}&decision=go`;
  const nogoUrl = `${siteUrl}/.netlify/functions/auto-apply-decision?jobId=${encodeURIComponent(job.id)}&token=${token}&decision=nogo`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Arial,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <div style="background:#4f46e5;padding:24px 28px;color:#fff;">
    <div style="font-size:12px;opacity:0.8;margin-bottom:4px;">AUTO-APPLY REVIEW REQUIRED</div>
    <h1 style="margin:0;font-size:22px;font-weight:700;">${escHtml(job.role || "Role")} @ ${escHtml(job.company || "Company")}</h1>
    <div style="margin-top:8px;font-size:14px;opacity:0.9;">Fit Score: <strong>${job.fit_score || 0}/100</strong> &nbsp;|&nbsp; ATS: ${escHtml(job.ats_family || "")}</div>
  </div>

  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:120px;">Role</td><td style="font-weight:600;font-size:14px;">${escHtml(job.role || "")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Company</td><td style="font-weight:600;font-size:14px;">${escHtml(job.company || "")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Salary</td><td style="font-size:14px;">${escHtml(job.salary_range || "Not stated")}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Fit Score</td><td style="font-size:14px;font-weight:700;color:#4f46e5;">${job.fit_score || 0}/100</td></tr>
    </table>
    <a href="${escHtml(job.link || '#')}" style="display:inline-block;padding:8px 16px;background:#f1f5f9;border-radius:6px;color:#4f46e5;text-decoration:none;font-size:13px;font-weight:600;">View Job Listing →</a>
  </div>

  <div style="padding:0 28px 24px;">
    <h2 style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;">📄 What Will Be Submitted</h2>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;">PROFESSIONAL SUMMARY</div>
      <div style="font-size:14px;line-height:1.6;color:#1e293b;">${escHtml(summary) || "<em>Will be generated from your CV</em>"}</div>
    </div>

    ${achievements.length ? `<div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;">KEY ACHIEVEMENTS (TOP 3)</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:#1e293b;">${achievementBullets}</ul>
    </div>` : ""}

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;">COVER LETTER</div>
      <div style="font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap;">${escHtml(answers.coverLetter || "")}</div>
    </div>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;">WHY THIS ROLE</div>
      <div style="font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap;">${escHtml(answers.whyThisRole || "")}</div>
    </div>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:8px;">WHY THIS COMPANY</div>
      <div style="font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-wrap;">${escHtml(answers.whyThisCompany || "")}</div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <a href="${goUrl}" style="flex:1;min-width:180px;display:block;text-align:center;padding:16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;">✅ GO — Approve</a>
      <a href="${nogoUrl}" style="flex:1;min-width:180px;display:block;text-align:center;padding:16px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;">❌ NO GO — Reject</a>
    </div>
  </div>

  <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
    Auto-Apply pipeline · adejob.netlify.app
  </div>
</div>
</body>
</html>`;
};

const escHtml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const generatePackForJob = async (db, job) => {
  const baseCvSections = await loadBaseCvSections(db);
  let tailoredSections = normalizeTailoredCvSections(job.tailored_cv_sections || {});
  let cvValidation = validateCvVariant({ baseSections: baseCvSections, tailoredSections });

  if (!tailoredSections || !Object.keys(tailoredSections).length) {
    if (!hasCvGenerationProvider()) throw new Error("No CV generation provider configured");
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

  const baseCvSectionsResolved = getResolvedCvSections({ baseSections: baseCvSections, tailoredSections });

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
    ats_family: job.ats_family,
    generated_at: generatedAt,
    cv_ready: true,
    answer_fields: Object.keys(answers).filter((key) => cleanText(answers[key])),
    master_cv_version: MASTER_CV_SCHEMA.version,
  };

  await db.collection("jobs").doc(job.id).update({
    tailored_cv_sections: tailoredSections,
    cv_validation: cvValidation,
    application_pack: applicationPack,
    application_pack_generated_at: generatedAt,
    application_answers: answers,
    apply_assistant_status: "pack_ready",
    updated_at: generatedAt,
  });

  return { answers, tailoredCvSections: tailoredSections, applicationPack, baseCvSections: baseCvSectionsResolved };
};

const matchesExcludeKeywords = (job, keywords) => {
  if (!keywords || !keywords.length) return false;
  const haystack = `${job.role || ""} ${job.company || ""} ${job.description || ""}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(String(kw).toLowerCase().trim()));
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  const db = getFirestore();
  const siteUrl = (process.env.SITE_URL || "https://adejob.netlify.app").replace(/\/$/, "");

  try {
    const prefsDoc = await db.collection("settings").doc("auto_apply_preferences").get();
    if (!prefsDoc.exists) {
      console.log("auto-apply-queue: no preferences configured");
      return { statusCode: 200, body: JSON.stringify({ skipped: "no_prefs" }) };
    }

    const prefs = prefsDoc.data();
    if (!prefs.enabled) {
      console.log("auto-apply-queue: disabled");
      return { statusCode: 200, body: JSON.stringify({ skipped: "disabled" }) };
    }

    const minFitScore = Number(prefs.min_fit_score || 75);
    const excludeKeywords = Array.isArray(prefs.exclude_keywords) ? prefs.exclude_keywords : [];
    const excludeCompanies = Array.isArray(prefs.exclude_companies)
      ? prefs.exclude_companies.map((c) => String(c).toLowerCase().trim())
      : [];

    const jobsSnap = await db
      .collection("jobs")
      .where("fit_score", ">=", minFitScore)
      .get();

    const candidates = jobsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((job) => {
        if (!SUPPORTED_ATS.has(job.ats_family)) return false;
        if (job.auto_apply_status) return false;
        const appStatus = (job.application_status || "").toLowerCase();
        if (appStatus === "applied" || appStatus === "rejected") return false;
        if (job.is_closed === true) return false;
        if (matchesExcludeKeywords(job, excludeKeywords)) return false;
        if (excludeCompanies.includes(String(job.company || "").toLowerCase().trim())) return false;
        if (prefs.require_salary_stated && !job.salary_range && !job.salary_min) return false;
        if (prefs.min_salary && Number(prefs.min_salary) > 0) {
          const jobMax = Number(job.salary_max || job.salary_min || 0);
          if (jobMax > 0 && jobMax < Number(prefs.min_salary)) return false;
        }
        return true;
      })
      .slice(0, 5);

    console.log(`auto-apply-queue: ${candidates.length} candidates to process`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const emailTo = prefs.email_to || process.env.SMTP_USER || "ademolaomosanya@gmail.com";
    const results = [];

    for (const job of candidates) {
      try {
        const now = new Date().toISOString();
        await db.collection("jobs").doc(job.id).update({
          auto_apply_status: "review_pending",
          auto_apply_queued_at: now,
        });

        const pack = await generatePackForJob(db, job);
        const token = generateToken(job.id);

        const htmlBody = buildEmailHtml(job, pack, token, siteUrl);

        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: emailTo,
          subject: `[Review Required] ${job.role || "Role"} @ ${job.company || "Company"} — Fit: ${job.fit_score || 0}/100`,
          html: htmlBody,
        });

        const emailSentAt = new Date().toISOString();
        await db.collection("jobs").doc(job.id).update({
          auto_apply_token: token,
          auto_apply_email_sent_at: emailSentAt,
          updated_at: emailSentAt,
        });

        results.push({ jobId: job.id, status: "email_sent" });
        console.log(`auto-apply-queue: email sent for ${job.id} (${job.role})`);
      } catch (jobErr) {
        console.error(`auto-apply-queue: failed for ${job.id}:`, jobErr);
        results.push({ jobId: job.id, status: "error", error: jobErr.message });
        await db.collection("jobs").doc(job.id).update({ auto_apply_status: null }).catch(() => {});
      }
    }

    return { statusCode: 200, body: JSON.stringify({ processed: results.length, results }) };
  } catch (error) {
    console.error("auto-apply-queue error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
