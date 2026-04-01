const { getFirestore, getStorageBucket } = require("./_firebase");
const { loadCvProfileText } = require("./_cv_generation");
const { default: OpenAI, toFile } = require("openai");

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

const buildAnalysisPrompt = (transcript, profileText, job) => `
You are a senior interview coach for UK fintech and financial crime product roles.
Analyse the interview transcript below against the candidate's CV profile and the target role.

Return JSON ONLY with these exact keys:

- overall_score: number 0-10 (one decimal place)
- overall_verdict: string (2-3 sentence summary verdict)
- dimension_scores: array of objects, each with:
    - dimension: string (exact name from list below)
    - score: number 0-10
    - note: string (one line reason)
- strengths: array of 3-5 strings (specific things done well, reference transcript moments)
- gaps: array of 3-5 strings (specific things missed or could be stronger)
- intelligence_gathered: array of objects, each with:
    - signal: string (what was learned about the role/company)
    - implication: string (what the candidate should do with this)
- next_round_prep: array of 4-6 strings (specific prep actions for next interview)
- core_gap_summary: string (the single most important thing to fix)

Dimensions to score (use these exact names):
${ANALYSIS_DIMENSIONS.map((d) => `- ${d}`).join("\n")}

Candidate CV:
${profileText}

Target role:
Title: ${job.role || ""}
Company: ${job.company || ""}
Description: ${job.notes || job.description || ""}

Interview transcript:
${transcript}
`.trim();

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse analysis JSON");
    return JSON.parse(match[0]);
  }
};

exports.handler = async (event) => {
  const db = getFirestore();

  let jobId, storagePath;
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

    // 1. Download audio from Firebase Storage
    const bucket = getStorageBucket();
    const file = bucket.file(storagePath);
    const [buffer] = await file.download();

    // 2. Transcribe with Whisper
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
    const openai = new OpenAI({ apiKey });

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

    // 3. Analyse with GPT-4o
    const jobDoc = await jobRef.get();
    const job = jobDoc.exists ? jobDoc.data() : {};
    const profileText = await loadCvProfileText(db);

    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: buildAnalysisPrompt(transcript, profileText, job) }],
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const analysis = parseJson(chatRes.choices[0]?.message?.content || "{}");

    // 4. Save to Firestore
    await jobRef.update({
      interview_transcript: transcript,
      interview_analysis: analysis,
      interview_storage_path: storagePath,
      interview_status: "done",
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
