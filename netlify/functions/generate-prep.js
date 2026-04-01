const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { loadCvProfileText } = require("./_cv_generation");
const OpenAI = require("openai");

const buildSpokenPrompt = (profileText, job) => {
  return (
    "You are a senior interview coach for UK fintech and financial crime product roles.\n" +
    "Given the candidate's real CV and a target job, generate interview answers written as\n" +
    "SPOKEN MONOLOGUES — not bullet points, not STAR labels, not headers.\n\n" +
    "Rules:\n" +
    "- First person, natural speech rhythm (contractions ok: \"I've\", \"it's\", \"we'd\")\n" +
    "- ~150 words = 60 seconds. ~220 words = 90 seconds. Count carefully.\n" +
    "- Opening hook: first sentence must grab attention and anchor the domain\n" +
    "- Closing punch: last sentence must land a specific achievement or forward-looking signal\n" +
    "- Draw ONLY from the candidate's real experience — no fabrication\n" +
    "- British English\n\n" +
    "Return JSON ONLY with these exact keys:\n" +
    "- spoken_intro_60s: string (~150 words, \"tell me about yourself\" conversational)\n" +
    "- spoken_intro_90s: string (~220 words, extended version)\n" +
    "- spoken_why_role: string (~120 words, why this specific company/role)\n" +
    "- spoken_working_style: string (~120 words, \"how do you work with product/stakeholders?\")\n" +
    "- spoken_stories: array of 3 objects, each with:\n" +
    "    - title: string (4-6 word label, e.g. \"Napier screening at Vistra\")\n" +
    "    - hook: string (first 1-2 sentences only — the most memorable part)\n" +
    "    - full: string (complete 60-90s spoken narrative drawn from that achievement)\n" +
    "- power_questions: array of 5 strings (smart questions to ask the interviewer)\n\n" +
    `Candidate CV:\n${profileText}\n\n` +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Description: ${job.notes || job.description || ""}\n`
  );
};

const parseSpokenFromText = (text) => {
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch (_) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse spoken answers response");
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

    if (!jobId) {
      return withCors({ error: "jobId required" }, 400);
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

    try {
      const client = new OpenAI({ apiKey });
      const prompt = buildSpokenPrompt(profileText, job);

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 5000,
        response_format: { type: "json_object" },
      });

      const text = response.choices[0]?.message?.content || "";
      const spoken = parseSpokenFromText(text);

      await db.collection("jobs").doc(jobId).update({
        spoken_intro_60s: spoken.spoken_intro_60s || "",
        spoken_intro_90s: spoken.spoken_intro_90s || "",
        spoken_why_role: spoken.spoken_why_role || "",
        spoken_working_style: spoken.spoken_working_style || "",
        spoken_stories: spoken.spoken_stories || [],
        power_questions: spoken.power_questions || [],
        prep_spoken_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return withCors({
        success: true,
        spoken_intro_60s: spoken.spoken_intro_60s || "",
        spoken_intro_90s: spoken.spoken_intro_90s || "",
        spoken_why_role: spoken.spoken_why_role || "",
        spoken_working_style: spoken.spoken_working_style || "",
        spoken_stories: spoken.spoken_stories || [],
        power_questions: spoken.power_questions || [],
      });
    } catch (error) {
      return withCors({ error: error.message || "Spoken answer generation failed" }, 500);
    }
  } catch (error) {
    console.error("generate-prep error:", error);
    return withCors({ error: error.message || "Spoken answer generation failed" }, 500);
  }
};
