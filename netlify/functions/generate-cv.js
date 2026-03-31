const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { generateTailoredCvBundle, hasCvGenerationProvider } = require("./_cv_generation");

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

    if (!hasCvGenerationProvider()) {
      return withCors({ error: "No CV generation provider configured" }, 500);
    }

    const db = getFirestore();

    // Read job from Firestore
    const jobDoc = await db.collection("jobs").doc(jobId).get();
    if (!jobDoc.exists) {
      return withCors({ error: "Job not found" }, 404);
    }
    const job = jobDoc.data();

    try {
      const result = await generateTailoredCvBundle({ db, job, apiKey: process.env.OPENAI_API_KEY });
      const sections = result.sections;

      // Write back to Firestore
      await db.collection("jobs").doc(jobId).update({
        tailored_cv_sections: sections,
        cv_validation: result.validation,
        cv_role_family: result.role_family || sections.role_family || "",
        cv_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return withCors({ success: true, sections, cvValidation: result.validation });
    } catch (error) {
      return withCors({ error: error.message || "CV generation failed" }, 500);
    }
  } catch (error) {
    console.error("generate-cv error:", error);
    return withCors({ error: error.message || "CV generation failed" }, 500);
  }
};
