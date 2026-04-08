const OpenAI = require("openai");
const {
  buildMasterCvPromptText,
  MASTER_CV_VERSION,
  normalizeTailoredCvSections,
  getDefaultBaseCvSections,
  finalizeTailoredCvSections,
} = require("./_cv_schema");
const { buildCvStyleProfilePrompt } = require("./_cv_style_profiles");
const { scoreEvidenceAlignment, buildOptimizedBaseSections } = require("./_cv_evidence_library");

const OPENAI_MODEL = process.env.OPENAI_CV_MODEL || "gpt-4o";
const OPENROUTER_MODEL = process.env.JOB_DIGEST_OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
const GROQ_MODEL = process.env.JOB_DIGEST_GROQ_MODEL || "llama-3.3-70b-versatile";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const buildCvPrompt = (profileText, job, styleProfilePrompt = "") => {
  return (
    "You are writing a UK CV variant for a candidate with an already-strong master CV. " +
    "The goal is selective improvement for the target role, not wholesale rewriting. " +
    "Return controlled overrides only and preserve the tone, density and factual discipline of the master CV.\n\n" +
    "Return JSON ONLY with a single key 'tailored_cv_sections' containing:\n" +
    "- master_cv_version: string\n" +
    "- summary: 3-4 sentences tailored to the role, in the same compact style as the master CV\n" +
    "- key_achievements: array of 5 bullets\n" +
    "- vistra_bullets: array of 5-7 bullets\n" +
    "- ebury_bullets: array of 4-5 bullets\n" +
    "- mema_bullets: array of 3-4 bullets\n" +
    "- elucidate_bullets: array of 3-4 bullets\n" +
    "- n26_bullets: array of 2-3 bullets\n" +
    "- experience_overrides: object with keys vistra, ebury, mema, elucidate, n26 mirroring the bullet arrays above\n" +
    "- notes: object with changed_sections array and locked_sections_preserved boolean\n\n" +
    "Rules:\n" +
    "- The master CV is the source of truth. Do not change employers, role titles, chronology, products, metrics, qualifications or scope beyond what the master supports\n" +
    "- Only rephrase, reorder and emphasise content already evidenced in the master CV\n" +
    "- If the master wording is already stronger, stay close to it instead of rewriting it\n" +
    "- Preserve concrete tools, platforms, jurisdictions, APIs, migrations, UAT, go-live and remediation details where relevant\n" +
    "- Do not duplicate the same metric across summary, achievements and experience bullets unless the master already requires it\n" +
    "- British English only\n" +
    "- No fabricated tools, sectors, products, teams or achievements\n" +
    "- No first-person pronouns in the summary\n" +
    "- No em dashes, arrows or decorative formatting. Use ATS-safe plain text only\n" +
    "- Do not use the phrases: results-driven, proven track record, skilled in, adept at, strong understanding, strong commercial acumen, data-driven, strategic thinker, business growth, transformative platform, transformative workflow, complex problems, strong analytical, methodologies\n" +
    "- Summary should open with the role domain and operating scope, not abstract framing like 'Within the...' or 'My experience...'\n" +
    "- No full stops at the end of bullet points\n" +
    "- De-duplicate metrics: each significant number or percentage appears ONCE across the entire CV (summary, achievements, experience bullets). Where you would repeat it, reference the outcome qualitatively instead (e.g. 'eliminated the primary bottleneck' rather than repeating '55%')\n" +
    "- At least half of all bullets must follow the action-then-outcome pattern: 'Did X; achieved Y' or 'Did X, improving Y'. Swap outcome-only bullets to include the action that drove the result\n" +
    "- Include exactly 1-2 lines in the summary or key achievements that describe working style in a specific, operational way — e.g. 'Runs weekly deep-dive sessions with ops leads; publishes SteerCo-ready packs with owners and dates'\n" +
    `- ${styleProfilePrompt}\n\n` +
    `Master CV:\n${buildMasterCvPromptText()}\n\n` +
    (profileText ? `Supplemental candidate notes:\n${profileText}\n\n` : "") +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Key requirements: ${(Array.isArray(job.key_requirements) ? job.key_requirements.join("; ") : "")}\n` +
    `Full description: ${job.description || job.role_summary || job.notes || ""}\n`
  );
};

const parseSectionsFromText = (text) => {
  try {
    const parsed = JSON.parse(text);
    return normalizeTailoredCvSections(parsed.tailored_cv_sections || parsed);
  } catch (_) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse CV response");
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeTailoredCvSections(parsed.tailored_cv_sections || parsed);
  }
};

const loadCvProfileText = async (db) => {
  const settingsDoc = await db.collection("settings").doc("cv_profile").get();
  return settingsDoc.exists ? settingsDoc.data().text || "" : "";
};

const loadBaseCvSections = async (db) => {
  const defaults = getDefaultBaseCvSections();
  try {
    const cvSettingsDoc = await db.collection("cv_settings").doc("base_cv").get();
    if (!cvSettingsDoc.exists) return defaults;
    return {
      ...defaults,
      ...(cvSettingsDoc.data() || {}),
    };
  } catch (_) {
    return defaults;
  }
};

const getCvProviders = () => {
  const forcedProvider = String(process.env.JOB_DIGEST_CV_PROVIDER || "").trim().toLowerCase();
  const providers = [];
  if (process.env.OPENAI_API_KEY && (!forcedProvider || forcedProvider === "openai")) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: OPENAI_MODEL,
      clientOptions: {},
    });
  }
  if (process.env.OPENROUTER_API_KEY && (!forcedProvider || forcedProvider === "openrouter")) {
    providers.push({
      name: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      clientOptions: {
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer": "https://adejob.netlify.app",
          "X-Title": "job-digest-portal",
        },
      },
    });
  }
  if (process.env.GROQ_API_KEY && (!forcedProvider || forcedProvider === "groq")) {
    providers.push({
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: GROQ_MODEL,
      clientOptions: {
        baseURL: GROQ_BASE_URL,
      },
    });
  }
  return providers;
};

const hasCvGenerationProvider = () => getCvProviders().length > 0;

const isRetryableProviderError = (error) => {
  const status = Number(error?.status || 0);
  return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
};

const generateWithProvider = async ({ provider, prompt }) => {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    ...provider.clientOptions,
  });
  const response = await client.chat.completions.create({
    model: provider.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.35,
    max_tokens: 4000,
  });
  const text = response.choices[0]?.message?.content || "";
  if (!text) {
    throw new Error(`No response content from ${provider.name}`);
  }
  return text;
};

const getStatusRank = (status) => {
  if (status === "accepted") return 3;
  if (status === "fallback_master") return 2;
  return 1;
};

const compareCandidates = (left, right) => {
  const statusDiff = getStatusRank(left.quality_status) - getStatusRank(right.quality_status);
  if (statusDiff !== 0) return statusDiff;
  const evidenceDiff = (left.evidence_alignment_score || 0) - (right.evidence_alignment_score || 0);
  if (evidenceDiff !== 0) return evidenceDiff;
  const scoreDiff = (left.validation?.quality_score || 0) - (right.validation?.quality_score || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const fallbackDiff = (right.quality_notes?.length || 0) - (left.quality_notes?.length || 0);
  if (fallbackDiff !== 0) return fallbackDiff;
  return (right.validation?.warnings?.length || 0) - (left.validation?.warnings?.length || 0);
};

const buildReferenceFallbackCandidate = ({ optimizedBaseSections, job, roleFamily, evidence, providerAttempts = [], lastError = null }) => {
  const fallbackFinalized = finalizeTailoredCvSections({
    baseSections: optimizedBaseSections,
    tailoredSections: optimizedBaseSections,
    job,
    providerName: "reference_fallback",
    styleProfileId: roleFamily,
  });

  return {
    ...fallbackFinalized,
    provider: "reference_fallback",
    style_profile: roleFamily,
    role_family: roleFamily,
    evidence_alignment_score: scoreEvidenceAlignment(fallbackFinalized.sections, job, { roleFamily }),
    quality_status: "accepted",
    quality_notes: [
      "Used the role-family optimised baseline because no LLM provider produced a usable draft.",
      ...(lastError?.message ? [`Last provider error: ${lastError.message}`] : []),
    ],
    provider_attempts: providerAttempts,
    evidence_context: evidence,
  };
};

const generateTailoredCvBundle = async ({ db, job, apiKey }) => {
  const profileText = await loadCvProfileText(db);
  const storedBaseCvSections = await loadBaseCvSections(db);
  if (apiKey && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = apiKey;
  }
  const providers = getCvProviders();
  const { profile, roleFamily, prompt: styleProfilePrompt, evidence } = buildCvStyleProfilePrompt(job);
  const { sections: optimizedBaseCvSections } = buildOptimizedBaseSections({
    job,
    baseSections: storedBaseCvSections,
  });
  if (!providers.length) {
    return buildReferenceFallbackCandidate({
      optimizedBaseSections: optimizedBaseCvSections,
      job,
      roleFamily,
      evidence,
    });
  }
  const prompt = buildCvPrompt(profileText, job, styleProfilePrompt);
  const candidates = [];
  let lastError = null;
  const providerAttempts = [];

  for (const provider of providers) {
    try {
      const text = await generateWithProvider({ provider, prompt });
      const parsedSections = parseSectionsFromText(text);
      const finalized = finalizeTailoredCvSections({
        baseSections: optimizedBaseCvSections,
        tailoredSections: parsedSections,
        job,
        providerName: provider.name,
        styleProfileId: profile.id,
      });
      const candidate = {
        ...finalized,
        provider: provider.name,
        style_profile: profile.id,
        role_family: roleFamily,
        evidence_alignment_score: scoreEvidenceAlignment(finalized.sections, job, { roleFamily }),
      };
      candidates.push(candidate);
      providerAttempts.push({
        provider: provider.name,
        quality_status: candidate.quality_status,
        quality_score: candidate.validation?.quality_score || 0,
        warning_count: candidate.validation?.warnings?.length || 0,
        evidence_alignment_score: candidate.evidence_alignment_score || 0,
      });

      if (
        candidate.quality_status === "accepted" &&
        (candidate.validation?.quality_score || 0) >= 90 &&
        candidate.evidence_alignment_score >= 6
      ) {
        break;
      }
    } catch (error) {
      lastError = error;
      providerAttempts.push({
        provider: provider.name,
        error: error.message || String(error),
        quality_status: "provider_error",
      });
      continue;
    }
  }

  if (!candidates.length) {
    return buildReferenceFallbackCandidate({
      optimizedBaseSections: optimizedBaseCvSections,
      job,
      roleFamily,
      evidence,
      providerAttempts,
      lastError,
    });
  }

  const bestCandidate = candidates.sort(compareCandidates).at(-1);
  return {
    ...bestCandidate,
    baseCvSections: optimizedBaseCvSections,
    provider_attempts: providerAttempts,
    evidence_context: evidence,
  };
};

const generateTailoredCvSections = async ({ db, job, apiKey }) => {
  const result = await generateTailoredCvBundle({ db, job, apiKey });
  return {
    ...result.sections,
    generated_by_provider: result.sections.generated_by_provider || "",
    master_cv_version: result.sections.master_cv_version || MASTER_CV_VERSION,
    quality_status: result.quality_status,
    quality_notes: result.quality_notes,
    style_profile: result.style_profile,
    role_family: result.role_family,
    notes: {
      locked_sections_preserved: true,
      provider_attempts: result.provider_attempts,
      evidence_reference_profile: result.evidence_context?.referenceProfile?.label || "",
      evidence_top_ids: (result.evidence_context?.rankedEvidence || []).map((item) => item.id),
      ...(result.sections.notes || {}),
    },
  };
};

module.exports = {
  buildCvPrompt,
  loadCvProfileText,
  loadBaseCvSections,
  hasCvGenerationProvider,
  generateTailoredCvBundle,
  generateTailoredCvSections,
};
