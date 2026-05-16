const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const SESSION_COLLECTION = "sessions";
const cleanDocId = (value) => String(value || "").trim().replace(/\//g, "").slice(0, 500);
const numberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const toIso = (value) => {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const serializeSession = (doc) => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    sessionId: data.sessionId || doc.id,
    jobId: data.jobId || null,
    questionId: data.questionId || "",
    questionText: data.questionText || "",
    category: data.category || "",
    transcript: data.transcript || "",
    webSpeechTranscript: data.webSpeechTranscript || "",
    whisperTranscript: data.whisperTranscript || "",
    whisperModel: data.whisperModel || "",
    transcriptionSource: data.transcriptionSource || "web_speech",
    rescored: Boolean(data.rescored),
    rescoredAt: data.rescoredAt || "",
    duration: numberValue(data.duration, 0),
    fillerCounts: data.fillerCounts || {},
    totalFillers: numberValue(data.totalFillers, 0),
    fpm: numberValue(data.fpm, 0),
    wpm: numberValue(data.wpm, 0),
    score: numberValue(data.score, 0),
    topFiller: data.topFiller || null,
    audioRef: data.audioRef || null,
    createdAtIso: data.createdAtIso || toIso(data.createdAt),
    createdAt: data.createdAtIso || toIso(data.createdAt),
    interrupted: Boolean(data.interrupted),
    queuedOffline: Boolean(data.queuedOffline),
    smokeTest: Boolean(data.smokeTest),
    source: data.source || "Speech Coach",
  };
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "GET") return withCors({ error: "Method not allowed" }, 405);

  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(Math.max(parseInt(params.limit || "50", 10) || 50, 1), 200);
    const jobId = cleanDocId(params.jobId || "");
    const category = String(params.category || "").trim();
    const db = getFirestore();
    const snap = await db.collection(SESSION_COLLECTION).orderBy("createdAt", "desc").limit(Math.max(limit, 50)).get();
    let sessions = snap.docs.map(serializeSession).filter((session) => !session.smokeTest);
    if (jobId) sessions = sessions.filter((session) => session.jobId === jobId);
    if (category) sessions = sessions.filter((session) => session.category === category);
    sessions = sessions.slice(0, limit);
    return withCors({ ok: true, sessions });
  } catch (error) {
    console.error("speech-sessions-list error", error);
    return withCors({ error: error.message || "Session list failed" }, 500);
  }
};
