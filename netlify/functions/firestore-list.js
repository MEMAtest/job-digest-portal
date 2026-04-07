const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const ALLOWED_COLLECTIONS = new Set(["auto_apply_decisions", "notifications"]);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "GET") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const collection = event.queryStringParameters?.collection;
    const limitParam = parseInt(event.queryStringParameters?.limit || "50", 10);

    if (!collection) {
      return withCors({ error: "Missing collection" }, 400);
    }
    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return withCors({ error: "Collection not allowed" }, 403);
    }

    const db = getFirestore();
    let query = db.collection(collection).orderBy("timestamp", "desc").limit(Math.min(limitParam, 200));
    const snap = await query.get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return withCors({ docs });
  } catch (error) {
    console.error("firestore-list error", error);
    return withCors({ error: error.message || "List failed" }, 500);
  }
};
