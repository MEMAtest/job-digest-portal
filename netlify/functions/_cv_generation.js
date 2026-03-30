const OpenAI = require("openai");
const { buildMasterCvPromptText, MASTER_CV_VERSION, normalizeTailoredCvSections } = require("./_cv_schema");

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
    "- Keep metrics real and non-duplicated across sections\n" +
    "- British English only\n" +
    "- No fabricated tools, sectors, products or achievements\n" +
    "- Prioritise recruiter credibility over keyword stuffing\n" +
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

const generateTailoredCvSections = async ({ db, job, apiKey }) => {
  const profileText = await loadCvProfileText(db);
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const prompt = buildCvPrompt(profileText, job);
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 4000,
  });

  const text = response.choices[0]?.message?.content || "";
  const sections = parseSectionsFromText(text);
  return {
    ...sections,
    master_cv_version: sections.master_cv_version || MASTER_CV_VERSION,
    notes: {
      locked_sections_preserved: true,
      ...(sections.notes || {}),
    },
  };
};

module.exports = {
  buildCvPrompt,
  loadCvProfileText,
  generateTailoredCvSections,
};
