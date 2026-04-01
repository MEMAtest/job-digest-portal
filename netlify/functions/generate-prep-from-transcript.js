const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { loadCvProfileText } = require("./_cv_generation");
const OpenAI = require("openai");

const buildDebriefPrompt = (profileText, job, transcript) => {
  return (
    "You are a senior interview coach for UK fintech and financial crime product roles.\n" +
    "You have been given:\n" +
    "1. The candidate's real CV\n" +
    "2. The target job description\n" +
    "3. A transcript of an interview that just took place\n\n" +
    "Analyse the interview rigorously. For each question the interviewer asked:\n" +
    "- Summarise what the candidate actually said (2–3 sentences)\n" +
    "- Rate it: \"strong\" / \"adequate\" / \"weak\" / \"missed\" (missed = question asked but not properly answered)\n" +
    "- Write an improved spoken answer drawing ONLY from the candidate's real CV\n" +
    "- Explain in one sentence why the improved answer is better\n\n" +
    "Also produce:\n" +
    "- round2_focus: 3–5 specific topics the candidate should drill before the next round (based on gaps in this interview)\n" +
    "- watch_outs: 2–3 verbal habits or structural issues to eliminate\n" +
    "- strengths: 2–3 things that landed well and should be repeated\n\n" +
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
    "}\n\n" +
    `Candidate CV:\n${profileText}\n\n` +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Description: ${job.notes || job.description || ""}\n\n` +
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return withCors({ error: "OpenAI API key not configured" }, 500);
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

    // Save transcript immediately so it persists even if analysis fails
    await db.collection("jobs").doc(jobId).update({
      debrief_transcript: transcript,
      updated_at: new Date().toISOString(),
    });

    try {
      const client = new OpenAI({ apiKey });
      const prompt = buildDebriefPrompt(profileText, job, transcript);

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 5000,
        response_format: { type: "json_object" },
      });

      const text = response.choices[0]?.message?.content || "";
      const debrief = parseDebriefFromText(text);

      const debriefAnalyzedAt = new Date().toISOString();

      await db.collection("jobs").doc(jobId).update({
        debrief_questions: debrief.debrief_questions || [],
        debrief_round2_focus: debrief.debrief_round2_focus || [],
        debrief_watch_outs: debrief.debrief_watch_outs || [],
        debrief_strengths: debrief.debrief_strengths || [],
        debrief_analyzed_at: debriefAnalyzedAt,
        updated_at: debriefAnalyzedAt,
      });

      return withCors({
        success: true,
        debrief_questions: debrief.debrief_questions || [],
        debrief_round2_focus: debrief.debrief_round2_focus || [],
        debrief_watch_outs: debrief.debrief_watch_outs || [],
        debrief_strengths: debrief.debrief_strengths || [],
        debrief_analyzed_at: debriefAnalyzedAt,
      });
    } catch (error) {
      return withCors({ error: error.message || "Debrief analysis failed" }, 500);
    }
  } catch (error) {
    console.error("generate-prep-from-transcript error:", error);
    return withCors({ error: error.message || "Debrief analysis failed" }, 500);
  }
};
