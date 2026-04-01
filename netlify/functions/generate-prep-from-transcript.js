const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { loadCvProfileText } = require("./_cv_generation");
const {
  validateDebriefPayload,
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

const buildDebriefPrompt = ({ profileText, job, transcript, retryFeedback = "" }) => {
  const retrySection = retryFeedback
    ? `\nFix these specific issues from the previous draft:\n${retryFeedback}\n`
    : "";

  return (
    "You are reviewing a real interview for a UK fintech, onboarding, compliance or financial crime product role.\n" +
    "Write the output so it is practical, direct and easy to use in rehearsal.\n\n" +
    "Good:\n" +
    "- sharp and specific\n" +
    "- natural spoken answers\n" +
    "- grounded in the candidate's real experience\n" +
    "- concise next-step coaching\n\n" +
    "Bad:\n" +
    "- generic praise\n" +
    "- formal written prose\n" +
    "- consultancy language\n" +
    "- invented detail\n" +
    "- long essay answers\n\n" +
    "Rules:\n" +
    "- improved_answer must sound like something the candidate would actually say aloud in interview\n" +
    "- improved_answer must be first person, British English, concise and specific\n" +
    "- do not use STAR labels or bullet logic inside improved answers\n" +
    "- do not use these phrases: results-driven, proven track record, seasoned professional, adept at, extensive experience, leverage, spearheaded, utilised, utilized, delve\n" +
    "- your_answer_summary should be a short factual summary of what the candidate actually said\n" +
    "- why_better should be one short sentence only\n" +
    "- round2_focus, watch_outs and strengths should be short direct lines, not paragraphs\n" +
    "- draw only from the candidate's real experience\n\n" +
    "Return JSON ONLY:\n" +
    "{\n" +
    '  "debrief_questions": [\n' +
    "    {\n" +
    '      "question": string,\n' +
    '      "rating": "strong" | "adequate" | "weak" | "missed",\n' +
    '      "your_answer_summary": string,\n' +
    '      "improved_answer": string,\n' +
    '      "why_better": string\n' +
    "    }\n" +
    "  ],\n" +
    '  "debrief_round2_focus": string[],\n' +
    '  "debrief_watch_outs": string[],\n' +
    '  "debrief_strengths": string[]\n' +
    "}\n" +
    retrySection +
    `\nCandidate CV:\n${profileText}\n\n` +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Description: ${job.notes || job.description || job.role_summary || ""}\n\n` +
    `Interview transcript:\n${transcript}`
  );
};

const parseDebriefFromText = (text) => {
  try {
    return JSON.parse(text);
  } catch (_) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse debrief response");
    }
    return JSON.parse(jsonMatch[0]);
  }
};

const normalizeDebriefPayload = (payload) => ({
  debrief_questions: (Array.isArray(payload?.debrief_questions) ? payload.debrief_questions : [])
    .slice(0, 8)
    .map((item) => ({
      question: String(item?.question || "").trim(),
      rating: String(item?.rating || "").trim(),
      your_answer_summary: String(item?.your_answer_summary || "").trim(),
      improved_answer: String(item?.improved_answer || "").trim(),
      why_better: String(item?.why_better || "").trim(),
    })),
  debrief_round2_focus: (Array.isArray(payload?.debrief_round2_focus) ? payload.debrief_round2_focus : [])
    .slice(0, 5)
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  debrief_watch_outs: (Array.isArray(payload?.debrief_watch_outs) ? payload.debrief_watch_outs : [])
    .slice(0, 4)
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  debrief_strengths: (Array.isArray(payload?.debrief_strengths) ? payload.debrief_strengths : [])
    .slice(0, 4)
    .map((item) => String(item || "").trim())
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
    temperature: 0.3,
    max_tokens: 5000,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content || "";
  if (!text) {
    throw new Error(`No response content from ${provider.name}`);
  }
  return text;
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "POST") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const jobId = payload.jobId;
    const transcript = payload.transcript;

    if (!jobId) {
      return withCors({ error: "jobId required" }, 400);
    }
    if (!transcript) {
      return withCors({ error: "transcript required" }, 400);
    }
    if (transcript.length > 30000) {
      return withCors({ error: "Transcript is too long (max 30,000 characters). Please trim it and try again." }, 400);
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

    await db.collection("jobs").doc(jobId).update({
      debrief_transcript: transcript,
      updated_at: new Date().toISOString(),
    });

    const candidates = [];
    let lastError = null;
    let retryFeedback = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const prompt = buildDebriefPrompt({ profileText, job, transcript, retryFeedback });
        const text = await generateWithProvider({ provider, prompt });
        const debrief = normalizeDebriefPayload(parseDebriefFromText(text));
        const validation = validateDebriefPayload(debrief, {
          jobRole: job.role || "",
          jobCompany: job.company || "",
        });
        candidates.push({ debrief, validation, attempt });
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
      return withCors({ error: lastError?.message || "Debrief analysis failed" }, 500);
    }

    const bestCandidate = candidates.sort(chooseBetterCandidate).at(-1);
    const shouldReject =
      bestCandidate.validation.decision === "fallback" ||
      (bestCandidate.validation.decision === "retry" &&
        (bestCandidate.validation.quality_score || 0) < 76);

    if (shouldReject) {
      return withCors(
        {
          error: "Generated debrief was not clear enough to save.",
          debrief_quality_status: "fallback",
          debrief_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
          debrief_quality_score: bestCandidate.validation.quality_score || 0,
        },
        422
      );
    }

    const debriefAnalyzedAt = new Date().toISOString();
    const qualityStatus =
      bestCandidate.validation.decision === "accept" && bestCandidate.attempt > 1 ? "retried" : bestCandidate.validation.decision;

    await db.collection("jobs").doc(jobId).update({
      debrief_questions: bestCandidate.debrief.debrief_questions || [],
      debrief_round2_focus: bestCandidate.debrief.debrief_round2_focus || [],
      debrief_watch_outs: bestCandidate.debrief.debrief_watch_outs || [],
      debrief_strengths: bestCandidate.debrief.debrief_strengths || [],
      debrief_quality_status: qualityStatus,
      debrief_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
      debrief_quality_score: bestCandidate.validation.quality_score || 0,
      debrief_provider: provider.name,
      debrief_analyzed_at: debriefAnalyzedAt,
      updated_at: debriefAnalyzedAt,
    });

    return withCors({
      success: true,
      ...bestCandidate.debrief,
      debrief_quality_status: qualityStatus,
      debrief_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
      debrief_quality_score: bestCandidate.validation.quality_score || 0,
      debrief_analyzed_at: debriefAnalyzedAt,
    });
  } catch (error) {
    console.error("generate-prep-from-transcript error:", error);
    return withCors({ error: error.message || "Debrief analysis failed" }, 500);
  }
};
