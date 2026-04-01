const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { loadCvProfileText } = require("./_cv_generation");
const {
  validateSpokenPayload,
  buildRetryFeedback,
  chooseBetterCandidate,
} = require("./_prep_language_validator");
const OpenAI = require("openai");

const OPENAI_MODEL = process.env.OPENAI_PREP_MODEL || "gpt-4o";

const getPrepProvider = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return {
    name: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    model: OPENAI_MODEL,
    clientOptions: {},
  };
};

const buildSpokenPrompt = ({ profileText, job, retryFeedback = "" }) => {
  const retrySection = retryFeedback
    ? `\nFix these specific issues from the previous draft:\n${retryFeedback}\n`
    : "";

  return (
    "You are writing interview answers for a real candidate in UK fintech, onboarding, compliance and financial crime product work.\n" +
    "Write answers that sound like something the candidate would actually say aloud in interview.\n\n" +
    "Good:\n" +
    "- direct\n" +
    "- specific\n" +
    "- natural spoken British English\n" +
    "- easy to rehearse aloud\n" +
    "- grounded in actual delivery work, platforms, controls and outcomes\n\n" +
    "Bad:\n" +
    "- CV-summary language\n" +
    "- generic coaching language\n" +
    "- consultancy phrasing\n" +
    "- abstract openings\n" +
    "- formal written prose\n" +
    "- STAR labels or bullet logic\n\n" +
    "Hard rules:\n" +
    "- first person\n" +
    "- British English\n" +
    "- natural spoken cadence with mostly short-to-medium sentences\n" +
    "- start with a concrete work or domain anchor\n" +
    "- do not open with 'I am', 'I have', 'With over', 'As a', 'Results-driven', 'Within the'\n" +
    "- do not use these phrases: results-driven, proven track record, seasoned professional, dynamic professional, adept at, extensive experience, leverage, spearheaded, utilised, utilized, delve, strong understanding, strategic thinker\n" +
    "- do not write like a CV, cover letter, essay or coaching note\n" +
    "- do not use semicolons, em dashes, arrows or decorative punctuation\n" +
    "- do not expose STAR headings; the story should still contain context, action and result naturally\n" +
    "- draw only from the candidate's real experience; no fabrication\n" +
    "- do not repeat the same metric or example across every answer unless genuinely needed\n\n" +
    "Length rules:\n" +
    "- spoken_intro_60s: 130-170 words\n" +
    "- spoken_intro_90s: 180-240 words\n" +
    "- spoken_why_role: 90-130 words and specific to this company/role\n" +
    "- spoken_working_style: 90-130 words\n" +
    "- each spoken_story.hook: 1-2 sentences\n" +
    "- each spoken_story.full: 110-170 words\n" +
    "- power_questions: short, sharp, specific questions the candidate can actually ask\n\n" +
    "Return JSON ONLY with these exact keys:\n" +
    "- spoken_intro_60s: string\n" +
    "- spoken_intro_90s: string\n" +
    "- spoken_why_role: string\n" +
    "- spoken_working_style: string\n" +
    "- spoken_stories: array of 3 objects, each with title, hook, full\n" +
    "- power_questions: array of 5 strings\n" +
    retrySection +
    `\nCandidate CV:\n${profileText}\n\n` +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Description: ${job.notes || job.description || job.role_summary || ""}\n`
  );
};

const parseSpokenFromText = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse spoken answers response");
    }
    return JSON.parse(jsonMatch[0]);
  }
};

const normalizeSpokenPayload = (payload) => ({
  spoken_intro_60s: String(payload?.spoken_intro_60s || "").trim(),
  spoken_intro_90s: String(payload?.spoken_intro_90s || "").trim(),
  spoken_why_role: String(payload?.spoken_why_role || "").trim(),
  spoken_working_style: String(payload?.spoken_working_style || "").trim(),
  spoken_stories: (Array.isArray(payload?.spoken_stories) ? payload.spoken_stories : [])
    .slice(0, 3)
    .map((story) => ({
      title: String(story?.title || "").trim(),
      hook: String(story?.hook || "").trim(),
      full: String(story?.full || "").trim(),
    })),
  power_questions: (Array.isArray(payload?.power_questions) ? payload.power_questions : [])
    .slice(0, 5)
    .map((question) => String(question || "").trim())
    .filter(Boolean),
});

const generateWithProvider = async ({ provider, prompt }) => {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    ...provider.clientOptions,
  });

  const response = await client.chat.completions.create({
    model: provider.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.35,
    max_tokens: 5000,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content || "";
  if (!text) {
    throw new Error(`No response content from ${provider.name}`);
  }
  return text;
};

const buildStoredSpokenPayload = ({ spoken, validation, provider, attemptCount }) => ({
  spoken_intro_60s: spoken.spoken_intro_60s || "",
  spoken_intro_90s: spoken.spoken_intro_90s || "",
  spoken_why_role: spoken.spoken_why_role || "",
  spoken_working_style: spoken.spoken_working_style || "",
  spoken_stories: spoken.spoken_stories || [],
  power_questions: spoken.power_questions || [],
  prep_quality_status: validation.decision === "accept" && attemptCount > 1 ? "retried" : validation.decision,
  prep_quality_notes: [...(validation.errors || []), ...(validation.warnings || [])].slice(0, 12),
  prep_quality_score: validation.quality_score || 0,
  prep_provider: provider.name,
});

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

    const provider = getPrepProvider();
    if (!provider) {
      return withCors({ error: "No prep generation provider configured" }, 500);
    }

    const db = getFirestore();

    const jobDoc = await db.collection("jobs").doc(jobId).get();
    if (!jobDoc.exists) {
      return withCors({ error: "Job not found" }, 404);
    }
    const job = jobDoc.data();

    const profileText = await loadCvProfileText(db);
    if (!profileText) {
      return withCors({ error: "CV profile not found in settings/cv_profile" }, 500);
    }

    const candidates = [];
    let lastError = null;
    let retryFeedback = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const prompt = buildSpokenPrompt({ profileText, job, retryFeedback });
        const text = await generateWithProvider({ provider, prompt });
        const spoken = normalizeSpokenPayload(parseSpokenFromText(text));
        const validation = validateSpokenPayload(spoken, {
          jobRole: job.role || "",
          jobCompany: job.company || "",
        });

        candidates.push({ spoken, validation, attempt });

        if (validation.decision === "accept") {
          break;
        }

        retryFeedback = buildRetryFeedback(validation);
      } catch (error) {
        lastError = error;
        retryFeedback = `- Provider error on previous attempt: ${error.message || String(error)}`;
      }
    }

    if (!candidates.length) {
      return withCors({ error: lastError?.message || "Spoken answer generation failed" }, 500);
    }

    const bestCandidate = candidates.sort(chooseBetterCandidate).at(-1);
    const shouldReject =
      bestCandidate.validation.decision === "fallback" ||
      (bestCandidate.validation.decision === "retry" &&
        (bestCandidate.validation.quality_score || 0) < 78);

    if (shouldReject) {
      return withCors(
        {
          error: "Generated spoken answers were not clear enough to save.",
          prep_quality_status: "fallback",
          prep_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
          prep_quality_score: bestCandidate.validation.quality_score || 0,
        },
        422
      );
    }

    const stored = buildStoredSpokenPayload({
      spoken: bestCandidate.spoken,
      validation: bestCandidate.validation,
      provider,
      attemptCount: bestCandidate.attempt,
    });

    await db.collection("jobs").doc(jobId).update({
      ...stored,
      prep_spoken_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return withCors({
      success: true,
      ...stored,
    });
  } catch (error) {
    console.error("generate-prep error:", error);
    return withCors({ error: error.message || "Spoken answer generation failed" }, 500);
  }
};
