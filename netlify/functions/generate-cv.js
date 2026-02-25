const { getFirestore } = require("./_firebase");
const OpenAI = require("openai");

const withCors = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(body),
});

const buildCvPrompt = (profileText, job) => {
  return (
    "You are a senior CV writer for UK fintech and financial services product roles. " +
    "Given the candidate's real CV and a target JD, produce tailored CV sections that " +
    "sound unmistakably human, pass ATS screening at 95%+ keyword coverage, and avoid " +
    "raising credibility eyebrows.\n\n" +
    "Return JSON ONLY with a single key 'tailored_cv_sections' containing:\n" +
    "- summary: 3-4 sentences (domain anchor + credentials + \"how you work\" line)\n" +
    "- key_achievements: array of 6-7 bullets (each metric appears HERE only, not repeated in role bullets)\n" +
    "- vistra_bullets: array of exactly 9 flat bullets (NO sub-headings, NO sub-sections)\n" +
    "- ebury_bullets: array of 4 bullets (qualitative if metrics already in key_achievements)\n\n" +
    "═══ HUMAN-READABILITY RULES (mandatory) ═══\n" +
    "1. DOMAIN ANCHOR: First sentence of summary names the specific domain for THIS role " +
    "(e.g., \"Identity, KYC and fraud product manager specialising in screening platforms, " +
    "authentication workflows and onboarding verification\"). Never open with generic " +
    "\"Product Manager with 13+ years...\"\n" +
    "2. NO TEMPLATE PHRASES: Never use \"proven track record\", \"strong analytical\", " +
    "\"complex cross-functional problems\", \"data-driven methodologies\", \"results-oriented\", " +
    "\"results-driven\", \"strong understanding\", \"strong commercial acumen\". Use concrete " +
    "verbs: built, redesigned, diagnosed, negotiated, shipped, wrote, ran, stood up, scoped.\n" +
    "3. DE-DUPLICATE METRICS: Each percentage/number appears ONCE in the entire output. " +
    "If 55% is in key_achievements, vistra_bullets must refer qualitatively " +
    "(\"eliminated the primary bottleneck in cycle time\"). Never repeat the same metric.\n" +
    "4. ACTION + OUTCOME BULLETS: At least half must follow \"Did X; achieved Y\". " +
    "E.g., \"Diagnosed bottlenecks across onboarding, QA and servicing workflows; " +
    "redesigned process flows to reduce journey friction\"\n" +
    "5. VARY LANGUAGE: Use \"customer experience\" once, then rotate: \"journey friction\", " +
    "\"drop-offs\", \"service levels\", \"cycle time\", \"throughput\". Never repeat a phrase " +
    "across bullets.\n" +
    "6. \"HOW YOU WORK\" LINE: Include exactly one sentence in summary describing working " +
    "style that is hard to fake. E.g., \"Run weekly deep-dive sessions with ops leads; " +
    "publish SteerCo-ready packs with owners, dates and dependency tracking.\"\n\n" +
    "═══ ATS RULES (target 95%+) ═══\n" +
    "- Mirror the JD's exact nouns: once in summary + once in skills/technical + naturally " +
    "in experience. Not everywhere.\n" +
    "- Prefer evidence-led keywords (\"built X dashboard\", \"reduced Y false positives\") " +
    "over generic descriptors (\"data-driven, strategic\")\n" +
    "- Use standard section headings the ATS can parse: PROFESSIONAL SUMMARY, KEY ACHIEVEMENTS, " +
    "PROFESSIONAL EXPERIENCE, TECHNICAL & PRODUCT CAPABILITIES, EDUCATION & CERTIFICATIONS\n" +
    "- Keep tool/platform lists relevant to THIS role; long stacks look padded\n\n" +
    "═══ CREDIBILITY RULES ═══\n" +
    "- No repeated metrics across sections. Each big number once (in achievements OR role " +
    "bullets), then qualitative.\n" +
    "- Audit-friendly numbers: include scope + baseline + method briefly. Over-precise or " +
    "\"perfect\" claims feel manufactured.\n" +
    "- Tool lists: prioritise what the role asks for. Don't list every tool you've touched.\n\n" +
    "═══ AI RESEMBLANCE RULES ═══\n" +
    "- Cut all template phrases unless immediately followed by a concrete example\n" +
    "- Vary sentence structure: mix short blunt lines (\"Stood up EDD squad\") with one " +
    "occasional longer line\n" +
    "- The \"how you work\" line is the single strongest anti-AI signal. Make it specific " +
    "and operational.\n\n" +
    "═══ FORMATTING ═══\n" +
    "- British English ONLY (optimised, organised, colour, centre, programme)\n" +
    "- NO full stops at the end of bullets\n" +
    "- NO em dashes; use commas, semicolons or \"to\"\n" +
    "- Keep real metrics (55%, 20%, 38%, £400k, 50k+, 470 PEP, £120k ARR): never water down\n" +
    "- Do NOT fabricate experience. Only rephrase, reorder and re-emphasise\n" +
    "- Fit within 2 A4 pages\n" +
    "- One consistent bullet style throughout (no mixed symbols)\n\n" +
    `Candidate CV:\n${profileText}\n\n` +
    "Target job:\n" +
    `Title: ${job.role || ""}\n` +
    `Company: ${job.company || ""}\n` +
    `Location: ${job.location || ""}\n` +
    `Summary: ${job.notes || job.description || ""}\n`
  );
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return withCors({});
  }

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

    // Read job from Firestore
    const jobDoc = await db.collection("jobs").doc(jobId).get();
    if (!jobDoc.exists) {
      return withCors({ error: "Job not found" }, 404);
    }
    const job = jobDoc.data();

    // Read base CV profile from Firestore settings
    const settingsDoc = await db.collection("settings").doc("cv_profile").get();
    const profileText = settingsDoc.exists ? settingsDoc.data().text : "";

    if (!profileText) {
      return withCors({ error: "CV profile not found in settings/cv_profile" }, 400);
    }

    // Build prompt and call OpenAI
    const prompt = buildCvPrompt(profileText, job);
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 4000,
    });

    const text = response.choices[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return withCors({ error: "Failed to parse CV response" }, 500);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const sections = parsed.tailored_cv_sections || parsed;

    // Write back to Firestore
    await db.collection("jobs").doc(jobId).update({
      tailored_cv_sections: sections,
      cv_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return withCors({ success: true, sections });
  } catch (error) {
    console.error("generate-cv error:", error);
    return withCors({ error: error.message || "CV generation failed" }, 500);
  }
};
