const { getFirestore } = require("./_firebase");

const withCors = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const db = getFirestore();
    const limit = Math.min(parseInt(event.queryStringParameters?.limit || "200", 10), 500);
    const collectionName = process.env.FIREBASE_COLLECTION || "jobs";
    const statsCollection = process.env.FIREBASE_STATS_COLLECTION || "job_stats";
    const suggestionsCollection = process.env.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions";
    const prepCollection = process.env.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep";

    const jobsSnap = await db.collection(collectionName).orderBy("fit_score", "desc").limit(limit).get();
    const jobs = jobsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const statsSnap = await db.collection(statsCollection).orderBy("date", "desc").limit(7).get();
    const stats = statsSnap.docs.map((doc) => doc.data());

    const suggestionsSnap = await db.collection(suggestionsCollection).orderBy("date", "desc").limit(1).get();
    const suggestions = suggestionsSnap.docs[0]?.data() || null;

    const prepSnap = await db.collection(prepCollection).orderBy("date", "desc").limit(1).get();
    const candidatePrep = prepSnap.docs[0]?.data() || null;

    return withCors({ jobs, stats, suggestions, candidatePrep });
  } catch (error) {
    console.error("jobs function error", error);
    return withCors({ error: error.message || "Failed to load jobs" }, 500);
  }
};
