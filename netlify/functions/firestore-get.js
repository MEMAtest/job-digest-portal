const { getFirestore } = require("./_firebase");

const withCors = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

const ALLOWED_COLLECTIONS = new Set(["run_requests", "notifications", "jobs", "cv_settings"]);

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const collection = event.queryStringParameters?.collection;
    const id = event.queryStringParameters?.id;

    if (!collection || !id) {
      return withCors({ error: "Missing collection or id" }, 400);
    }
    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return withCors({ error: "Collection not allowed" }, 403);
    }

    const db = getFirestore();
    const snap = await db.collection(collection).doc(id).get();
    if (!snap.exists) {
      return withCors({ data: null });
    }
    return withCors({ data: snap.data() });
  } catch (error) {
    console.error("get function error", error);
    return withCors({ error: error.message || "Fetch failed" }, 500);
  }
};
