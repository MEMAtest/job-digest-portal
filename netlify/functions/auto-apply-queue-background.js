const { getFirestore } = require("./_firebase");
const { generateTailoredCvBundle, hasCvGenerationProvider, loadBaseCvSections } = require("./_cv_generation");
const {
  MASTER_CV_SCHEMA,
  getResolvedCvSections,
  normalizeTailoredCvSections,
  validateCvVariant,
  finalizeTailoredCvSections,
} = require("./_cv_schema");
const { assessApplicationPackQuality, buildAtsKeywordCoverage } = require("./_auto_apply_quality");
const { buildApplicationAnswers, validateApplicationAnswers } = require("./_application_quality");
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

const generateToken = (jobId) => {
  const secret = process.env.AUTO_APPLY_HMAC_SECRET;
  if (!secret) throw new Error("AUTO_APPLY_HMAC_SECRET not set");
  return crypto.createHmac("sha256", secret).update(jobId).digest("hex");
};

// Hours since a role was posted, or null if undateable. Used to keep the scan
// off stale roles whose listings have since closed (the "out of date links"
// problem). Prefers the parsed posted_date; falls back to relative text.
const jobHoursSince = (job) => {
  const raw = job.posted_date || "";
  if (raw) {
    const t = Date.parse(String(raw).replace(" ", "T"));
    if (!Number.isNaN(t)) return (Date.now() - t) / 3600000;
  }
  const text = String(job.posted || job.posted_raw || "").toLowerCase();
  if (!text) return null;
  if (/\bnew\b|just now|today|minute|\bmins?\b/.test(text)) return 0.5;
  if (text.includes("yesterday")) return 24;
  const m = text.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (text.includes("hour")) return n;
  if (text.includes("day")) return n * 24;
  if (text.includes("week")) return n * 168;
  return null;
};

// Application statuses that mean "don't queue this for auto-apply" — already
// applied, explicitly rejected/dismissed, or already progressing (interview/
// offer) so we must not re-apply.
const SKIP_APP_STATUSES = new Set(["applied", "rejected", "dismissed", "interview", "offer"]);
const PREPARING_LOCK_MS = 60 * 60 * 1000;

const hasActiveAutoApplyStatus = (job) => {
  if (!job.auto_apply_status) return false;
  if (job.auto_apply_status !== "preparing") return true;
  const queuedAt = Date.parse(job.auto_apply_queued_at || "");
  return Number.isFinite(queuedAt) && Date.now() - queuedAt < PREPARING_LOCK_MS;
};

// Probe whether a listing still resolves. Only drops a role on POSITIVE evidence
// it's gone (404/410/451) — keeps it on 200, redirects, 403/5xx, or any network
// error, so a flaky board or a HEAD-hostile ATS never wrongly discards a good
// role. This is the fix for "fresh but already-closed" roles slipping the
// freshness gate (the listing closed inside its posting window).
const isListingLive = async (url) => {
  if (!/^https?:\/\//i.test(url || "")) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; adejob-autoapply/1.0)" },
    });
    return ![404, 410, 451].includes(resp.status);
  } catch {
    return true; // network/timeout — fail open, don't discard a possibly-good role
  } finally {
    clearTimeout(timer);
  }
};

const expireStaleReviewItems = async (db, maxHours) => {
  const pendingSnap = await db.collection("jobs").where("auto_apply_status", "==", "review_pending").get();
  const expiredAt = new Date().toISOString();
  const stale = pendingSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((job) => {
      const hours = jobHoursSince(job);
      return hours !== null && hours > maxHours;
    });

  await Promise.all(
    stale.map((job) =>
      db.collection("jobs").doc(job.id).update({
        auto_apply_status: "expired",
        auto_apply_expired_at: expiredAt,
        auto_apply_expired_reason: `Listing is older than the ${maxHours}-hour review window`,
        updated_at: expiredAt,
      }),
    ),
  );
  return stale.length;
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

  const cvValidation = pack.cvValidation || pack.applicationPack?.cv_validation || job.cv_validation || {};
  const qualityStatus = tailoredSections.quality_status || cvValidation.quality_status || "";
  const qualityScore = cvValidation.quality_score || cvValidation.metrics?.quality_score || "";
  const applicationValidation = pack.applicationValidation || job.application_validation || {};
  const applicationQualityScore = applicationValidation.quality_score || "";
  const qualityNotes = Array.isArray(tailoredSections.quality_notes) ? tailoredSections.quality_notes : [];
  const isAiTailored = qualityStatus === "accepted";
  const qualityLabel = isAiTailored
    ? `AI Tailored${qualityScore ? ` — Score: ${qualityScore}/100` : ""}`
    : qualityStatus === "fallback_master" ? "Master CV used (AI tailoring fell back)" : "Generated";
  const qualityColour = isAiTailored ? "#16a34a" : "#d97706";

  const atsCoverage = buildAtsKeywordCoverage(job, tailoredSections);
  const atsLabel = atsCoverage
    ? `${atsCoverage.score}% (${atsCoverage.found}/${atsCoverage.total} requirements matched)`
    : "Not checked";
  const atsColour = atsCoverage && atsCoverage.score >= 80 ? "#16a34a" : "#d97706";

  const goUrl = `${siteUrl}/.netlify/functions/auto-apply-decision?jobId=${encodeURIComponent(job.id)}&token=${encodeURIComponent(token)}&decision=go`;
  const nogoUrl = `${siteUrl}/.netlify/functions/auto-apply-decision?jobId=${encodeURIComponent(job.id)}&token=${encodeURIComponent(token)}&decision=nogo`;

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
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">CV Quality</td><td style="font-size:14px;font-weight:600;color:${qualityColour};">${escHtml(qualityLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Application Quality</td><td style="font-size:14px;font-weight:600;color:${applicationValidation.ok ? "#16a34a" : "#d97706"};">${applicationQualityScore ? `${applicationQualityScore}/100` : "Not checked"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">ATS Coverage</td><td style="font-size:14px;font-weight:600;color:${atsColour};">${escHtml(atsLabel)}</td></tr>
    </table>
    ${qualityNotes.length ? `<div style="background:#fef9c3;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#854d0e;"><strong>Quality notes:</strong><ul style="margin:6px 0 0;padding-left:18px;">${qualityNotes.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul></div>` : ""}
    ${atsCoverage && atsCoverage.missing.length ? `<div style="background:#fef3c7;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e;"><strong>Missing keywords:</strong> ${escHtml(atsCoverage.missing.slice(0, 5).join(", "))}${atsCoverage.missing.length > 5 ? ` +${atsCoverage.missing.length - 5} more` : ""}</div>` : ""}
    <a href="${escHtml(/^https?:\/\//i.test(job.link || '') ? job.link : '#')}" style="display:inline-block;padding:8px 16px;background:#f1f5f9;border-radius:6px;color:#4f46e5;text-decoration:none;font-size:13px;font-weight:600;">View Job Listing →</a>
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

  const generatedAt = new Date().toISOString();
  const applicationPack = {
    ats_family: job.ats_family,
    generated_at: generatedAt,
    cv_ready: true,
    answer_fields: Object.keys(answers).filter((key) => cleanText(answers[key])),
    master_cv_version: MASTER_CV_SCHEMA.version,
    application_quality_score: applicationValidation.quality_score,
  };

  await db.collection("jobs").doc(job.id).update({
    tailored_cv_sections: tailoredSections,
    cv_validation: cvValidation,
    application_pack: applicationPack,
    application_pack_generated_at: generatedAt,
    application_answers: answers,
    application_validation: applicationValidation,
    apply_assistant_status: "pack_ready",
    updated_at: generatedAt,
  });

  return {
    answers,
    tailoredCvSections: tailoredSections,
    applicationPack,
    applicationValidation,
    baseCvSections: baseCvSectionsResolved,
    cvValidation,
  };
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
    // Manual UI triggers ("Scan now") bypass the enabled toggle; cron-scheduled
    // runs send {"scheduled":true} and are treated as non-manual so they respect
    // prefs.enabled (skip silently when auto-apply is switched off).
    const body = event.body ? (() => { try { return JSON.parse(event.body); } catch { return {}; } })() : {};
    const isScheduled = body.scheduled === true || body.mode === "scheduled";
    const isManual = (event.httpMethod === "POST" || body.manual === true) && !isScheduled;

    // --- Pack pre-warming (Part C) ---
    // Build application packs ahead of time for fresh, high-fit, supported-ATS,
    // low-applicant roles so one-click "Apply now" is instant. No GO/NO-GO email,
    // no auto_apply_status changes — this only prepares materials. Runs in
    // parallel (bounded) and skips roles already tailored to avoid wasted spend.
    if (body.mode === "prewarm") {
      const minFit = Number(process.env.PREWARM_MIN_FIT || 78);
      const maxJobs = Number(process.env.PREWARM_MAX_JOBS || 5);
      const concurrency = Math.max(1, Number(process.env.PREWARM_CONCURRENCY || 2));
      const maxHours = Number(process.env.HOT_LANE_MAX_HOURS || 4);
      const maxApplicants = Number(process.env.HOT_LANE_MAX_APPLICANTS || 25);

      const hoursSince = jobHoursSince;
      const parseApplicants = (v) => {
        const m = String(v || "").match(/\d[\d,]*/);
        return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
      };

      const warmSnap = await db.collection("jobs").where("fit_score", ">=", minFit).get();
      const toWarm = warmSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((job) => {
          if (!SUPPORTED_ATS.has(job.ats_family)) return false;
          const appStatus = (job.application_status || "").toLowerCase();
          if (SKIP_APP_STATUSES.has(appStatus)) return false;
          if (job.is_closed === true) return false;
          if (job.tailored_cv_sections && Object.keys(job.tailored_cv_sections).length) return false;
          const h = hoursSince(job);
          if (h === null || h < 0 || h > maxHours) return false;
          const n = parseApplicants(job.applicant_count);
          if (n !== null && n > maxApplicants) return false;
          return true;
        })
        .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0))
        .slice(0, maxJobs);

      console.log(`auto-apply-queue[prewarm]: ${toWarm.length} role(s) to warm`);
      const warmOne = async (job) => {
        await generatePackForJob(db, job);
        await db.collection("jobs").doc(job.id).update({ application_pack_prewarmed: true }).catch(() => {});
        return job.id;
      };
      const results = [];
      for (let i = 0; i < toWarm.length; i += concurrency) {
        const batch = toWarm.slice(i, i + concurrency);
        const settled = await Promise.allSettled(batch.map(warmOne));
        settled.forEach((s, k) => {
          if (s.status === "fulfilled") {
            results.push({ jobId: s.value, status: "prewarmed" });
          } else {
            const msg = s.reason && s.reason.message ? s.reason.message : String(s.reason);
            console.error(`auto-apply-queue[prewarm]: failed for ${batch[k].id}:`, msg);
            results.push({ jobId: batch[k].id, status: "error", error: msg });
          }
        });
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ mode: "prewarm", warmed: results.filter((r) => r.status === "prewarmed").length, results }),
      };
    }

    if (!prefs.enabled && !isManual) {
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

    // Only queue roles posted recently — otherwise the scan surfaces months-old
    // high-fit roles from history whose listings have closed, so every GO/NO-GO
    // and "View listing" link is dead ("all the links were out of date").
    const maxHours = Number(prefs.max_role_age_hours ?? process.env.AUTO_APPLY_MAX_HOURS ?? 72);
    const expiredReviewItems = await expireStaleReviewItems(db, maxHours);
    if (expiredReviewItems > 0) {
      console.log(`auto-apply-queue: expired ${expiredReviewItems} stale review item(s)`);
    }

    const candidates = jobsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((job) => {
        if (!SUPPORTED_ATS.has(job.ats_family)) return false;
        if (hasActiveAutoApplyStatus(job)) return false;
        const appStatus = (job.application_status || "").toLowerCase();
        if (SKIP_APP_STATUSES.has(appStatus)) return false;
        if (job.is_closed === true) return false;
        // Freshness gate: skip undateable, future-dated, or stale roles.
        const h = jobHoursSince(job);
        if (h === null || h < 0 || h > maxHours) return false;
        if (matchesExcludeKeywords(job, excludeKeywords)) return false;
        if (excludeCompanies.includes(String(job.company || "").toLowerCase().trim())) return false;
        if (prefs.require_salary_stated && !job.salary_range && !job.salary_min) return false;
        if (prefs.min_salary && Number(prefs.min_salary) > 0) {
          const jobMax = Number(job.salary_max || job.salary_min || 0);
          if (jobMax > 0 && jobMax < Number(prefs.min_salary)) return false;
        }
        return true;
      })
      // Freshest first, then highest fit — so the 5 we queue are the most
      // likely to still be open and worth applying to.
      .sort((a, b) => {
        const ha = jobHoursSince(a) ?? Infinity;
        const hb = jobHoursSince(b) ?? Infinity;
        return ha - hb || (b.fit_score || 0) - (a.fit_score || 0);
      })
      .slice(0, 5);

    // Drop roles whose listing has already closed (404/410/451) even though
    // they're inside the freshness window — the "dead link" the user saw.
    const liveness = await Promise.all(candidates.map((job) => isListingLive(job.link)));
    const liveCandidates = candidates.filter((_, i) => liveness[i]);
    const droppedDead = candidates.length - liveCandidates.length;
    if (droppedDead > 0) console.log(`auto-apply-queue: dropped ${droppedDead} role(s) with dead listings`);

    console.log(`auto-apply-queue: ${liveCandidates.length} candidates to process`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const emailTo = prefs.email_to || process.env.TO_EMAIL || process.env.SMTP_USER || "ademolaomosanya@gmail.com";
    const minAtsCoverage = Number(prefs.min_ats_coverage ?? 80);
    const minCvQualityScore = Number(prefs.min_cv_quality_score ?? 90);
    const minApplicationQualityScore = Number(prefs.min_application_quality_score ?? 90);
    const requireAtsCoverage = prefs.require_ats_coverage !== false;
    const results = [];

    for (const job of liveCandidates) {
      try {
        const now = new Date().toISOString();
        await db.collection("jobs").doc(job.id).update({
          auto_apply_status: "preparing",
          auto_apply_queued_at: now,
        });

        const pack = await generatePackForJob(db, job);
        const qualityGate = assessApplicationPackQuality({
          job,
          pack,
          minAtsCoverage,
          minCvQualityScore,
          minApplicationQualityScore,
          requireAtsCoverage,
        });
        const gateCheckedAt = new Date().toISOString();
        const gateData = {
          passed: qualityGate.passed,
          reasons: qualityGate.reasons,
          cv_quality_score: qualityGate.cvQualityScore,
          cv_quality_status: qualityGate.cvQualityStatus,
          min_cv_quality_score: minCvQualityScore,
          application_quality_score: qualityGate.applicationQualityScore,
          min_application_quality_score: minApplicationQualityScore,
          min_ats_coverage: minAtsCoverage,
          checked_at: gateCheckedAt,
        };
        await db.collection("jobs").doc(job.id).update({
          auto_apply_quality_gate: gateData,
          ats_keyword_coverage: qualityGate.atsCoverage,
          updated_at: gateCheckedAt,
        });

        if (!qualityGate.passed) {
          await db.collection("jobs").doc(job.id).update({ auto_apply_status: "quality_hold" });
          results.push({ jobId: job.id, status: "quality_hold", reasons: qualityGate.reasons });
          console.log(`auto-apply-queue: quality hold for ${job.id}: ${qualityGate.reasons.join("; ")}`);
          continue;
        }

        const token = generateToken(job.id);
        await db.collection("jobs").doc(job.id).update({ auto_apply_status: "review_pending" });

        const htmlBody = buildEmailHtml(job, pack, token, siteUrl);

        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: emailTo,
          subject: `[Review Required] ${job.role || "Role"} @ ${job.company || "Company"} — Fit: ${job.fit_score || 0}/100`,
          html: htmlBody,
        });

        // Email already sent — the timestamp is nice-to-have. Swallow errors so
        // a failed update here can't trip the catch below and reset the role to
        // null, which would re-queue it and send a DUPLICATE email next run.
        const emailSentAt = new Date().toISOString();
        await db.collection("jobs").doc(job.id).update({
          auto_apply_email_sent_at: emailSentAt,
          updated_at: emailSentAt,
        }).catch((e) => console.error(`auto-apply-queue: post-send update failed for ${job.id}:`, e.message));

        results.push({ jobId: job.id, status: "email_sent" });
        console.log(`auto-apply-queue: email sent for ${job.id} (${job.role})`);
      } catch (jobErr) {
        console.error(`auto-apply-queue: failed for ${job.id}:`, jobErr);
        results.push({ jobId: job.id, status: "error", error: jobErr.message });
        await db.collection("jobs").doc(job.id).update({ auto_apply_status: null }).catch(() => {});
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ processed: results.length, expired: expiredReviewItems, results }),
    };
  } catch (error) {
    console.error("auto-apply-queue error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
