const { getFirestore, getStorageBucket, getStorageBucketCandidates } = require("./_firebase");
const { loadCvProfileText } = require("./_cv_generation");
const {
  validateInterviewAnalysisPayload,
  buildRetryFeedback,
  chooseBetterCandidate,
} = require("./_prep_language_validator");
const {
  buildTextProviders,
  buildTranscriptionProviders,
  generateTextWithProvider,
  transcribeAudioWithProvider,
} = require("./_prep_ai");

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

const downloadInterviewFile = async ({ storagePath, storageBucketName = "" }) => {
  const candidates = storageBucketName
    ? [storageBucketName, ...getStorageBucketCandidates().filter((name) => name !== storageBucketName)]
    : getStorageBucketCandidates();
  let lastError = null;

  for (const bucketName of candidates) {
    try {
      const file = getStorageBucket(bucketName).file(storagePath);
      const [buffer] = await file.download();
      return { buffer, bucketName };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Interview recording could not be downloaded from storage");
};

const transcribeInterview = async ({ buffer, storagePath }) => {
  const providers = buildTranscriptionProviders();
  if (!providers.length) {
    throw new Error("No transcription provider configured");
  }

  let lastError = null;
  const attempts = [];

  for (const provider of providers) {
    try {
      const transcript = await transcribeAudioWithProvider({
        provider,
        buffer,
        fileName: storagePath.split("/").pop() || "interview.m4a",
        mimeType: "audio/mp4",
        language: "en",
      });
      attempts.push({ provider: provider.name, status: "success" });
      return { transcript, providerName: provider.name, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({
        provider: provider.name,
        status: "error",
        error: error.message || String(error),
      });
    }
  }

  throw new Error(lastError?.message || "Interview transcription failed");
};

const generateAnalysis = async ({ transcript, profileText, job }) => {
  const providers = buildTextProviders();
  if (!providers.length) {
    throw new Error("No prep generation provider configured");
  }

  const candidates = [];
  const providerAttempts = [];
  let lastError = null;

  for (const provider of providers) {
    let retryFeedback = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const text = await generateTextWithProvider({
          provider,
          prompt: buildAnalysisPrompt({ transcript, profileText, job, retryFeedback }),
          temperature: 0.25,
          maxTokens: 3000,
        });

        const parsed = normalizeAnalysis(parseJson(text || "{}"));
        const validation = validateInterviewAnalysisPayload(parsed, {
          jobRole: job.role || "",
          jobCompany: job.company || "",
        });
        candidates.push({ analysis: parsed, validation, attempt, providerName: provider.name });
        providerAttempts.push({
          provider: provider.name,
          attempt,
          decision: validation.decision,
          quality_score: validation.quality_score || 0,
        });

        if (validation.decision === "accept" && (validation.quality_score || 0) >= 88) {
          break;
        }

        retryFeedback = buildRetryFeedback(validation);
      } catch (error) {
        lastError = error;
        providerAttempts.push({
          provider: provider.name,
          attempt,
          error: error.message || String(error),
        });
        retryFeedback = `- Provider error on previous attempt: ${error.message || String(error)}`;
      }
    }

    const currentBest = candidates.sort(chooseBetterCandidate).at(-1);
    if (currentBest?.validation?.decision === "accept" && (currentBest.validation?.quality_score || 0) >= 90) {
      break;
    }
  }

  if (!candidates.length) {
    throw new Error(lastError?.message || "Interview analysis generation failed");
  }

  return {
    bestCandidate: candidates.sort(chooseBetterCandidate).at(-1),
    providerAttempts,
  };
};

exports.handler = async (event) => {
  const db = getFirestore();

  let jobId;
  let storagePath;
  let storageBucketName;
  try {
    const payload = JSON.parse(event.body || "{}");
    jobId = payload.jobId;
    storagePath = payload.storagePath;
    storageBucketName = payload.storageBucket;
  } catch {
    return { statusCode: 400, body: "Bad request" };
  }

  if (!jobId || !storagePath) {
    return { statusCode: 400, body: "jobId and storagePath required" };
  }

  const jobRef = db.collection("jobs").doc(jobId);

  try {
    await jobRef.update({ interview_status: "processing", interview_updated_at: new Date().toISOString() });

    const { buffer, bucketName } = await downloadInterviewFile({ storagePath, storageBucketName });
    const transcriptionResult = await transcribeInterview({ buffer, storagePath });
    const transcript = transcriptionResult.transcript || "";

    const jobDoc = await jobRef.get();
    const job = jobDoc.exists ? jobDoc.data() : {};
    const profileText = await loadCvProfileText(db);

    const { bestCandidate, providerAttempts } = await generateAnalysis({
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
      interview_storage_bucket: bucketName,
      interview_status: "done",
      interview_quality_status: qualityStatus,
      interview_quality_notes: [...(bestCandidate.validation.errors || []), ...(bestCandidate.validation.warnings || [])].slice(0, 12),
      interview_quality_score: bestCandidate.validation.quality_score || 0,
      interview_analysis_provider: bestCandidate.providerName,
      interview_analysis_provider_attempts: providerAttempts,
      interview_transcription_provider: transcriptionResult.providerName,
      interview_transcription_attempts: transcriptionResult.attempts,
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
