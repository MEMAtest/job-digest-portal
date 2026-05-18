const admin = require("firebase-admin");
const crypto = require("crypto");
const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");
const { generateAiSpeechReview } = require("./_speech_ai_review");

const SESSION_COLLECTION = "sessions";
const JOB_COLLECTION = process.env.FIREBASE_COLLECTION || "jobs";

const cleanId = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
const numberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const stringValue = (value, max = 50000) => String(value || "").slice(0, max);
const toDate = (value) => {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};
const toIso = (value) => {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const transcriptHash = (session = {}) =>
  crypto
    .createHash("sha256")
    .update([
      stringValue(session.questionId, 120),
      stringValue(session.questionText, 1000),
      stringValue(session.transcript || session.whisperTranscript || session.webSpeechTranscript, 50000),
      String(numberValue(session.duration, 0)),
    ].join("\n---\n"))
    .digest("hex");

const serializeSession = (id, data = {}) => ({
  id,
  sessionId: data.sessionId || id,
  jobId: data.jobId || null,
  questionId: data.questionId || "",
  questionText: data.questionText || "",
  questionModelAnswer: data.questionModelAnswer || "",
  category: data.category || "",
  transcript: data.transcript || "",
  webSpeechTranscript: data.webSpeechTranscript || data.transcript || "",
  whisperTranscript: data.whisperTranscript || "",
  whisperModel: data.whisperModel || "",
  transcriptionSource: data.transcriptionSource || "web_speech",
  transcriptPending: Boolean(data.transcriptPending),
  audioCaptured: Boolean(data.audioCaptured || data.audioRef),
  captureDiagnostics: data.captureDiagnostics || null,
  rescored: Boolean(data.rescored),
  rescoredAt: data.rescoredAt || "",
  duration: numberValue(data.duration, 0),
  fillerCounts: data.fillerCounts || {},
  totalFillers: numberValue(data.totalFillers, 0),
  fpm: numberValue(data.fpm, 0),
  wpm: numberValue(data.wpm, 0),
  baseScore: numberValue(data.baseScore ?? data.score, 0),
  score: numberValue(data.score, 0),
  phase3Score: data.phase3Score == null ? null : numberValue(data.phase3Score, 0),
  scoreType: data.scoreType || "filler_score",
  topFiller: data.topFiller || null,
  speechReview: data.speechReview || null,
  aiReview: data.aiReview || null,
  audioRef: data.audioRef || null,
  createdAtIso: data.createdAtIso || toIso(data.createdAt),
  createdAt: data.createdAtIso || toIso(data.createdAt),
  device: data.device || "",
  interrupted: Boolean(data.interrupted),
  queuedOffline: Boolean(data.queuedOffline),
  smokeTest: Boolean(data.smokeTest),
  source: data.source || "Speech Coach",
});

const calculateTrend = (sessions) => {
  if (!Array.isArray(sessions) || sessions.length < 5) return { direction: "flat", delta: 0, lastAvg: null, priorAvg: null };
  const sorted = [...sessions].sort((left, right) => toDate(right.createdAt).getTime() - toDate(left.createdAt).getTime());
  const last = sorted.length >= 10 ? sorted.slice(0, 5) : sorted.slice(0, Math.ceil(sorted.length / 2));
  const prior = sorted.length >= 10 ? sorted.slice(5, 10) : sorted.slice(Math.ceil(sorted.length / 2));
  if (!prior.length) return { direction: "flat", delta: 0, lastAvg: null, priorAvg: null };
  const avg = (items) => items.reduce((sum, item) => sum + numberValue(item.fpm, 0), 0) / items.length;
  const lastAvg = avg(last);
  const priorAvg = avg(prior);
  const delta = Number((priorAvg - lastAvg).toFixed(1));
  const direction = Math.abs(delta) < 0.2 ? "flat" : delta > 0 ? "improving" : "worsening";
  return { direction, delta, lastAvg: Number(lastAvg.toFixed(1)), priorAvg: Number(priorAvg.toFixed(1)) };
};

const recomputePracticeStats = async (db, jobId) => {
  if (!jobId) return null;
  const snap = await db.collection(SESSION_COLLECTION).where("jobId", "==", jobId).get();
  const sessions = snap.docs.map((doc) => doc.data());
  if (!sessions.length) return null;
  const sessionCount = sessions.length;
  const avgScore = sessions.reduce((sum, item) => sum + numberValue(item.score, 0), 0) / sessionCount;
  const avgFpm = sessions.reduce((sum, item) => sum + numberValue(item.fpm, 0), 0) / sessionCount;
  const bestScore = Math.max(...sessions.map((item) => numberValue(item.score, 0)));
  const latest = [...sessions].sort((left, right) => toDate(right.createdAt).getTime() - toDate(left.createdAt).getTime())[0];
  const recentSessions = [...sessions]
    .sort((left, right) => toDate(right.createdAt).getTime() - toDate(left.createdAt).getTime())
    .slice(0, 5)
    .map((item) => ({
      id: item.id || item.sessionId || "",
      createdAtIso: toIso(item.createdAt) || item.createdAtIso || "",
      score: numberValue(item.score, 0),
      fpm: numberValue(item.fpm, 0),
      questionText: item.questionText || "",
    }));
  const trend = calculateTrend(sessions);
  const practiceStats = {
    sessionCount,
    avgScore: Number(avgScore.toFixed(1)),
    avgFpm: Number(avgFpm.toFixed(2)),
    bestScore: Math.round(bestScore),
    latestScore: numberValue(latest.score, 0),
    lastSessionAt: latest.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    lastSessionAtIso: toIso(latest.createdAt) || latest.createdAtIso || "",
    trendDirection: trend.direction,
    trendDelta: trend.delta,
    trendLastAvg: trend.lastAvg,
    trendPriorAvg: trend.priorAvg,
    recentSessions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const jobSnap = await jobRef.get();
  if (jobSnap.exists) await jobRef.set({ practiceStats }, { merge: true });
  return practiceStats;
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") return withCors({ error: "Method not allowed" }, 405);

  try {
    const payload = JSON.parse(event.body || "{}");
    const sessionId = cleanId(payload.sessionId || payload.id);
    const force = Boolean(payload.force);
    if (!sessionId) return withCors({ error: "Missing session id" }, 400);

    const db = getFirestore();
    const ref = db.collection(SESSION_COLLECTION).doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists) return withCors({ error: "Session not found" }, 404);

    const existing = snap.data() || {};
    const hash = transcriptHash(existing);
    if (!force && existing.aiReview?.status === "complete" && existing.aiReview?.transcriptHash === hash) {
      return withCors({
        ok: true,
        status: "cached",
        session: serializeSession(sessionId, existing),
        aiReview: existing.aiReview,
      });
    }

    const result = await generateAiSpeechReview({ ...existing, transcriptHash: hash });
    if (!result.review) {
      return withCors({
        ok: true,
        status: result.status,
        providerConfigured: Boolean(result.providerConfigured),
        reason: result.reason || "",
      });
    }

    const baseScore = numberValue(existing.baseScore ?? existing.score, 0);
    const update = {
      baseScore,
      score: result.review.combinedScore,
      phase3Score: result.review.combinedScore,
      scoreType: "ai_combined",
      aiReview: {
        ...result.review,
        transcriptHash: hash,
      },
      aiReviewedAt: result.review.createdAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(update, { merge: true });
    const updated = { ...existing, ...update };
    const practiceStats = await recomputePracticeStats(db, existing.jobId || null);

    return withCors({
      ok: true,
      status: result.status,
      providerConfigured: Boolean(result.providerConfigured),
      session: serializeSession(sessionId, updated),
      aiReview: update.aiReview,
      practiceStats,
    });
  } catch (error) {
    console.error("speech-session-review error", error);
    return withCors({ error: error.message || "Speech AI review failed" }, 500);
  }
};
