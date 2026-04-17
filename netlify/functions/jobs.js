const { getFirestore, getFirebaseRuntimeMeta } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const FRESH_WINDOW_HOURS = Math.max(parseInt(process.env.JOB_DIGEST_WINDOW_HOURS || "24", 10) || 24, 1);
const DEFAULT_MIN_SCORE = parseInt(process.env.JOB_DIGEST_MIN_SCORE || "70", 10) || 70;
const DEFAULT_COMPANY_SEARCH_LIMIT = Math.max(parseInt(process.env.JOB_DIGEST_COMPANY_SEARCH_LIMIT || "0", 10) || 0, 0);

const parseOptionalInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const normalizeApplicationStatus = (value) => {
  const status = String(value || "saved").trim().toLowerCase();
  if (!status) return "saved";
  if (status === "dismiss") return "dismissed";
  if (status === "shortlist") return "shortlisted";
  return status;
};

const normalizeJob = (job) => ({
  ...job,
  application_status: normalizeApplicationStatus(job?.application_status),
});

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
  const status = normalizeApplicationStatus(job?.application_status);
  if (status === "saved" || status === "new") {
    return isFreshPortalJob(job);
  }
  return true;
};

const buildJobsMeta = ({ collectionName, queriedJobs, returnedJobs }) => {
  const runtimeMeta = getFirebaseRuntimeMeta();
  const savedNewTotal = queriedJobs.filter((job) => ["saved", "new"].includes(job.application_status)).length;
  const freshSavedNewCount = queriedJobs.filter(
    (job) => ["saved", "new"].includes(job.application_status) && isFreshPortalJob(job)
  ).length;
  const staleSavedNewCount = Math.max(savedNewTotal - freshSavedNewCount, 0);
  const emptyReason =
    freshSavedNewCount === 0
      ? `0 fresh saved/new jobs in collection ${collectionName} within last ${FRESH_WINDOW_HOURS}h.`
      : "";

  return {
    source: "proxy",
    project_id: runtimeMeta.projectId || process.env.FIREBASE_PROJECT_ID || "",
    collection: collectionName,
    window_hours: FRESH_WINDOW_HOURS,
    min_score: DEFAULT_MIN_SCORE,
    company_search_limit: DEFAULT_COMPANY_SEARCH_LIMIT,
    job_board_count: parseOptionalInt(process.env.JOB_DIGEST_JOB_BOARD_COUNT || process.env.JOB_DIGEST_ACTIVE_JOB_BOARD_COUNT),
    workday_feed_count: parseOptionalInt(process.env.JOB_DIGEST_WORKDAY_FEED_COUNT || process.env.JOB_DIGEST_WORKDAY_COUNT),
    queried_docs: queriedJobs.length,
    returned_jobs: returnedJobs.length,
    saved_new_total: savedNewTotal,
    fresh_saved_new_count: freshSavedNewCount,
    stale_saved_new_count: staleSavedNewCount,
    empty_reason: emptyReason,
    generated_at: new Date().toISOString(),
  };
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
    const queriedJobs = jobsSnap.docs
      .map((doc) => normalizeJob({ id: doc.id, ...doc.data() }));
    const jobs = queriedJobs
      .filter(shouldIncludePortalJob)
      .slice(0, limit);
    const meta = buildJobsMeta({ collectionName, queriedJobs, returnedJobs: jobs });

    const statsSnap = await db.collection(statsCollection).orderBy("date", "desc").limit(7).get();
    const stats = statsSnap.docs.map((doc) => doc.data());

    const suggestionsSnap = await db.collection(suggestionsCollection).orderBy("date", "desc").limit(1).get();
    const suggestions = suggestionsSnap.docs[0]?.data() || null;

    const prepSnap = await db.collection(prepCollection).orderBy("date", "desc").limit(1).get();
    const candidatePrep = prepSnap.docs[0]?.data() || null;

    return withCors({ jobs, stats, suggestions, candidatePrep, meta });
  } catch (error) {
    console.error("jobs function error", error);
    return withCors({ error: error.message || "Failed to load jobs" }, 500);
  }
};
