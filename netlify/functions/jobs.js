const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const FRESH_WINDOW_HOURS = Math.max(parseInt(process.env.JOB_DIGEST_WINDOW_HOURS || "24", 10) || 24, 1);

const parseDateValue = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    const seconds = value._seconds ?? value.seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const date = new Date(`${value.trim()}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return null;
};

const parseRelativeHours = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "new" || text.includes("newly posted") || text.includes("just now") || text.includes("today")) return 0;
  if (text.includes("minute") || /\bmin\b/.test(text)) return 1 / 60;
  if (text.includes("yesterday")) return 24;
  const match = text.match(/(\d+)/);
  const amount = match ? Number(match[1]) : null;
  if (!amount) return null;
  if (text.includes("hour")) return amount;
  if (text.includes("day")) return amount * 24;
  if (text.includes("week")) return amount * 7 * 24;
  return null;
};

const isFreshPortalJob = (job, windowHours = FRESH_WINDOW_HOURS) => {
  const postedDate = parseDateValue(job?.posted_date);
  if (postedDate) {
    return Date.now() - postedDate.getTime() <= windowHours * 3600000;
  }
  const relativeHours = parseRelativeHours(job?.posted_raw || job?.posted || "");
  if (relativeHours !== null) {
    return relativeHours <= windowHours;
  }
  const fallbackDate = parseDateValue(job?.last_seen_at || job?.created_at || job?.updated_at);
  if (!fallbackDate) return false;
  return Date.now() - fallbackDate.getTime() <= windowHours * 3600000;
};

const shouldIncludePortalJob = (job) => {
  // Always include jobs in the auto-apply pipeline regardless of age
  if (job?.auto_apply_status) return true;
  const status = String(job?.application_status || "saved").toLowerCase();
  if (status === "saved" || status === "new") {
    return isFreshPortalJob(job);
  }
  return true;
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();

  if (event.httpMethod !== "GET") {
    return withCors({ error: "Method not allowed" }, 405);
  }

  try {
    const db = getFirestore();
    const limit = Math.min(parseInt(event.queryStringParameters?.limit || "200", 10), 500);
    const queryLimit = Math.min(Math.max(limit * 3, limit), 500);
    const collectionName = process.env.FIREBASE_COLLECTION || "jobs";
    const statsCollection = process.env.FIREBASE_STATS_COLLECTION || "job_stats";
    const suggestionsCollection = process.env.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions";
    const prepCollection = process.env.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep";

    const jobsSnap = await db.collection(collectionName).orderBy("updated_at", "desc").limit(queryLimit).get();
    const jobs = jobsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(shouldIncludePortalJob)
      .slice(0, limit);

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
