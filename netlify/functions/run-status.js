const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "GET") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const db = getFirestore();
    const collectionName = process.env.FIREBASE_RUN_REQUESTS_COLLECTION || "run_requests";
    const id = event.queryStringParameters?.id || "latest";
    const snap = await db.collection(collectionName).doc(id).get();

    if (!snap.exists) {
      return withCors({ data: null });
    }

    return withCors({ data: snap.data() });
  } catch (error) {
    console.error("run-status function error", error);
    return withCors({ error: error.message || "Failed to load run status" }, 500);
  }
};
