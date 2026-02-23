const { getFirestore } = require("./_firebase");

const withCors = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

const ALLOWED_COLLECTIONS = new Set(["jobs", "run_requests", "notifications", "job_stats", "role_suggestions", "candidate_prep"]);

exports.handler = async (event) => {
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
