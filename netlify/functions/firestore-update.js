const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const ALLOWED_COLLECTIONS = new Set(["jobs", "run_requests", "notifications", "job_stats", "role_suggestions", "candidate_prep", "push_subscriptions", "auto_apply_decisions", "settings"]);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "POST") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const collection = payload.collection;
    const id = payload.id;
    const data = payload.data;

    if (!collection || !id || !data) {
      return withCors({ error: "Missing collection, id, or data" }, 400);
    }
    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return withCors({ error: "Collection not allowed" }, 403);
    }

    const db = getFirestore();
    await db.collection(collection).doc(id).set(data, { merge: true });
    return withCors({ ok: true });
  } catch (error) {
    console.error("update function error", error);
    return withCors({ error: error.message || "Update failed" }, 500);
  }
};
