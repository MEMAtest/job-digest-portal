const OpenAI = require("openai");
const { buildMasterCvPromptText, MASTER_CV_VERSION, normalizeTailoredCvSections } = require("./_cv_schema");

const OPENAI_MODEL = process.env.OPENAI_CV_MODEL || "gpt-4o";
const OPENROUTER_MODEL = process.env.JOB_DIGEST_OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
const GROQ_MODEL = process.env.JOB_DIGEST_GROQ_MODEL || "llama-3.3-70b-versatile";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const buildCvPrompt = (profileText, job) => {
  return (
    "You are a senior CV writer for UK fintech and financial services product roles. " +
    "You are given the candidate's canonical master CV and a target job. Produce controlled overrides only. " +
    "Do not rewrite the full CV from scratch.\n\n" +
    "Return JSON ONLY with a single key 'tailored_cv_sections' containing:\n" +
    "- master_cv_version: string\n" +
    "- summary: 3-4 sentences tailored to the role\n" +
    "- key_achievements: array of 5-6 bullets\n" +
    "- vistra_bullets: array of 5-7 bullets\n" +
    "- ebury_bullets: array of 4-5 bullets\n" +
    "- mema_bullets: array of 3-4 bullets\n" +
    "- elucidate_bullets: array of 3-4 bullets\n" +
    "- n26_bullets: array of 2-3 bullets\n" +
    "- experience_overrides: object with keys vistra, ebury, mema, elucidate, n26 mirroring the bullet arrays above\n" +
    "- notes: object with changed_sections array and locked_sections_preserved boolean\n\n" +
    "Rules:\n" +
    "- The master CV is the source of truth. Do not change employers, role titles, chronology or qualifications\n" +
    "- Only rephrase, reorder and emphasise content that already exists in the master CV\n" +
    "- Keep metrics real and non-duplicated across summary, achievements and role bullets. Each major number should appear once only\n" +
    "- British English only\n" +
    "- No fabricated tools, sectors, products or achievements\n" +
    "- Prioritise recruiter credibility over keyword stuffing\n" +
    "- Summary must open with the domain and operating scope, not empty self-praise\n" +
    "- Do not use the phrases: results-driven, proven track record, skilled in, adept at, strong understanding, strong commercial acumen, data-driven, strategic thinker\n" +
    "- Summary should be 2-3 sentences and mostly qualitative. Keep hard metrics in key achievements, not in the summary\n" +
    "- Use concrete verbs like built, led, defined, designed, delivered, implemented, reduced, standardised\n" +
    "- No arrows or decorative formatting. Use plain ATS-safe text only\n" +
    `Master CV:\n${buildMasterCvPromptText()}\n\n` +
    (profileText ? `Supplemental candidate notes:\n${profileText}\n\n` : "") +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Summary: ${job.notes || job.description || ""}\n`
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
    temperature: 0.4,
    max_tokens: 4000,
  });
  const text = response.choices[0]?.message?.content || "";
  if (!text) {
    throw new Error(`No response content from ${provider.name}`);
  }
  return text;
};

const generateTailoredCvSections = async ({ db, job, apiKey }) => {
  const profileText = await loadCvProfileText(db);
  if (apiKey && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = apiKey;
  }
  const providers = getCvProviders();
  if (!providers.length) {
    throw new Error("No CV generation provider configured");
  }

  const prompt = buildCvPrompt(profileText, job);
  let lastError = null;

  for (const provider of providers) {
    try {
      const text = await generateWithProvider({ provider, prompt });
      const sections = parseSectionsFromText(text);
      return {
        ...sections,
        generated_by_provider: provider.name,
        master_cv_version: sections.master_cv_version || MASTER_CV_VERSION,
        notes: {
          locked_sections_preserved: true,
          ...(sections.notes || {}),
        },
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("CV generation failed");
};

module.exports = {
  buildCvPrompt,
  loadCvProfileText,
  hasCvGenerationProvider,
  generateTailoredCvSections,
};
