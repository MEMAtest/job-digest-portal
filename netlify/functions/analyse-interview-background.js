const { getFirestore, getStorageBucket } = require("./_firebase");
const { loadCvProfileText } = require("./_cv_generation");
const {
  validateInterviewAnalysisPayload,
  buildRetryFeedback,
  chooseBetterCandidate,
} = require("./_prep_language_validator");
const { default: OpenAI, toFile } = require("openai");

const OPENAI_MODEL = process.env.OPENAI_PREP_MODEL || "gpt-4o";

const ANALYSIS_DIMENSIONS = [
  "Domain knowledge",
  "Structured answers (STAR)",
  "Quantified impact",
  "Stakeholder/compliance handling",
  "B2C awareness",
  "Governance depth",
  "Questions asked",
  "Confidence/fluency",
];

const buildAnalysisPrompt = ({ transcript, profileText, job, retryFeedback = "" }) => {
  const retrySection = retryFeedback
    ? `\nFix these specific issues from the previous draft:\n${retryFeedback}\n`
    : "";

  return `
You are assessing a real interview for a UK fintech, onboarding, compliance or financial crime product role.
Write the review in direct, practical English. The candidate should be able to act on it immediately.

Good:
- specific
- concise
- grounded in transcript evidence
- clear next-step advice

Bad:
- generic praise
- padded verdicts
- consultancy language
- vague "improve communication" comments
- repeated notes that say the same thing in different words

Return JSON ONLY with these exact keys:

- overall_score: number 0-10 (one decimal place)
- overall_verdict: string (2 short paragraphs max, direct and specific)
- dimension_scores: array of objects, each with:
    - dimension: string (exact name from list below)
    - score: number 0-10
    - note: string (one short sentence only)
- strengths: array of 3-5 strings (specific things done well)
- gaps: array of 3-5 strings (specific misses or weaknesses)
- intelligence_gathered: array of objects, each with:
    - signal: string (what the candidate learned)
    - implication: string (what to do with it next)
- next_round_prep: array of 4-6 strings (short, direct prep actions)
- core_gap_summary: string (one sharp sentence)

Rules:
- dimension notes must be one sentence only
- overall_verdict must be direct and free of generic praise padding
- next_round_prep must be specific tasks, not abstract advice
- do not use these phrases: results-driven, proven track record, seasoned professional, adept at, extensive experience, leverage, spearheaded, utilised, utilized, delve
- do not invent transcript details or achievements

Dimensions to score (use these exact names):
${ANALYSIS_DIMENSIONS.map((dimension) => `- ${dimension}`).join("\n")}
${retrySection}

Candidate CV:
${profileText}

Target role:
Title: ${job.role || ""}
Company: ${job.company || ""}
Description: ${job.notes || job.description || job.role_summary || ""}

Interview transcript:
${transcript}
`.trim();
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse analysis JSON");
    return JSON.parse(match[0]);
  }
};

const normalizeAnalysis = (payload) => ({
  overall_score: Number(payload?.overall_score || 0),
  overall_verdict: String(payload?.overall_verdict || "").trim(),
  dimension_scores: (Array.isArray(payload?.dimension_scores) ? payload.dimension_scores : [])
    .map((item) => ({
      dimension: String(item?.dimension || "").trim(),
      score: Number(item?.score || 0),
      note: String(item?.note || "").trim(),
    }))
    .filter((item) => item.dimension),
  strengths: (Array.isArray(payload?.strengths) ? payload.strengths : [])
    .slice(0, 5)
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  gaps: (Array.isArray(payload?.gaps) ? payload.gaps : [])
    .slice(0, 5)
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  intelligence_gathered: (Array.isArray(payload?.intelligence_gathered) ? payload.intelligence_gathered : [])
    .slice(0, 5)
    .map((item) => ({
      signal: String(item?.signal || "").trim(),
      implication: String(item?.implication || "").trim(),
    }))
    .filter((item) => item.signal || item.implication),
  next_round_prep: (Array.isArray(payload?.next_round_prep) ? payload.next_round_prep : [])
    .slice(0, 6)
    .map((item) => String(item || "").trim())
    .filter(Boolean),
  core_gap_summary: String(payload?.core_gap_summary || "").trim(),
});

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey });
};

const generateAnalysis = async ({ openai, transcript, profileText, job }) => {
  const candidates = [];
  let retryFeedback = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const chatRes = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: buildAnalysisPrompt({ transcript, profileText, job, retryFeedback }) }],
      temperature: 0.25,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const parsed = normalizeAnalysis(parseJson(chatRes.choices[0]?.message?.content || "{}"));
    const validation = validateInterviewAnalysisPayload(parsed, {
      jobRole: job.role || "",
      jobCompany: job.company || "",
    });
    candidates.push({ analysis: parsed, validation, attempt });

    if (validation.decision === "accept") {
      break;
    }

    retryFeedback = buildRetryFeedback(validation);
  }

  return candidates.sort(chooseBetterCandidate).at(-1);
};

exports.handler = async (event) => {
  const db = getFirestore();

  let jobId;
  let storagePath;
  try {
    const payload = JSON.parse(event.body || "{}");
    jobId = payload.jobId;
    storagePath = payload.storagePath;
  } catch {
    return { statusCode: 400, body: "Bad request" };
  }

  if (!jobId || !storagePath) {
    return { statusCode: 400, body: "jobId and storagePath required" };
  }

  const jobRef = db.collection("jobs").doc(jobId);

  try {
    await jobRef.update({ interview_status: "processing", interview_updated_at: new Date().toISOString() });

    const bucket = getStorageBucket();
    const file = bucket.file(storagePath);
    const [buffer] = await file.download();

    const openai = getClient();
    const audioFile = await toFile(
      buffer,
      storagePath.split("/").pop() || "interview.m4a",
      { type: "audio/mp4" }
    );

    const transcriptionRes = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "en",
    });
    const transcript = transcriptionRes.text || "";

    const jobDoc = await jobRef.get();
    const job = jobDoc.exists ? jobDoc.data() : {};
    const profileText = await loadCvProfileText(db);

    const bestCandidate = await generateAnalysis({
      openai,
      transcript,
      profileText,
      job,
    });

    if (!bestCandidate) {
      throw new Error("Interview analysis did not return a usable result");
    }

    const shouldReject =
      bestCandidate.validation.decision === "fallback" ||
      (bestCandidate.validation.decision === "retry" &&
        (bestCandidate.validation.quality_score || 0) < 74);

    if (shouldReject) {
      throw new Error("Interview analysis was too generic to save");
    }

    const qualityStatus =
      bestCandidate.validation.decision === "accept" && bestCandidate.attempt > 1
        ? "retried"
        : bestCandidate.validation.decision;

    await jobRef.update({
      interview_transcript: transcript,
      interview_analysis: bestCandidate.analysis,
      interview_storage_path: storagePath,
      interview_status: "done",
      interview_quality_status: qualityStatus,
      interview_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
      interview_quality_score: bestCandidate.validation.quality_score || 0,
      interview_analysed_at: new Date().toISOString(),
      interview_updated_at: new Date().toISOString(),
    });

    return { statusCode: 200 };
  } catch (err) {
    console.error("analyse-interview error:", err);
    await jobRef?.update({
      interview_status: "error",
      interview_error: err.message || "Unknown error",
      interview_updated_at: new Date().toISOString(),
    }).catch(() => {});
    return { statusCode: 500, body: err.message };
  }
};
