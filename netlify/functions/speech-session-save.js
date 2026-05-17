const admin = require("firebase-admin");
const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const SESSION_COLLECTION = "sessions";
const QUESTION_COLLECTION = "questionBank";
const JOB_COLLECTION = process.env.FIREBASE_COLLECTION || "jobs";
const FILLER_KEYS = ["kind of", "obviously", "I think", "probably", "maybe", "you know", "sort of", "I guess", "essentially", "to be honest", "I'd say", "like"];

const cleanId = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
const cleanDocId = (value) => String(value || "").trim().replace(/\//g, "").slice(0, 500);
const numberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const stringValue = (value, max = 20000) => String(value || "").slice(0, max);
const toDate = (value) => {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
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

const sanitizeFillerCounts = (counts = {}) => {
  const result = {};
  FILLER_KEYS.forEach((key) => {
    result[key] = Math.max(0, Math.round(numberValue(counts[key], 0)));
  });
  return result;
};

const sanitizeReview = (review = null) => {
  if (!review || typeof review !== "object") return null;
  const cleanList = (items, maxItems = 6) =>
    Array.isArray(items) ? items.slice(0, maxItems).map((item) => stringValue(item, 500)).filter(Boolean) : [];
  const metrics = review.metrics && typeof review.metrics === "object" ? review.metrics : {};
  return {
    version: numberValue(review.version, 1),
    score: Math.max(0, Math.min(100, Math.round(numberValue(review.score, 0)))),
    verdict: stringValue(review.verdict, 80),
    createdAt: stringValue(review.createdAt || new Date().toISOString(), 80),
    metrics: {
      words: numberValue(metrics.words, 0),
      sentences: numberValue(metrics.sentences, 0),
      fpm: numberValue(metrics.fpm, 0),
      wpm: numberValue(metrics.wpm, 0),
      totalFillers: numberValue(metrics.totalFillers, 0),
      modelKeywordCoverage: metrics.modelKeywordCoverage === null ? null : numberValue(metrics.modelKeywordCoverage, 0),
      matchedKeywords: cleanList(metrics.matchedKeywords, 20),
      missingKeywords: cleanList(metrics.missingKeywords, 20),
      hasMetric: Boolean(metrics.hasMetric),
      hasEvidence: Boolean(metrics.hasEvidence),
      hasStructure: Boolean(metrics.hasStructure),
      hasOpeningJudgement: Boolean(metrics.hasOpeningJudgement),
      hasClose: Boolean(metrics.hasClose),
    },
    strengths: cleanList(review.strengths),
    fixes: cleanList(review.fixes),
    betterAnswer: stringValue(review.betterAnswer, 2500),
    drill: stringValue(review.drill, 500),
  };
};

const sanitizeAiReview = (review = null) => {
  if (!review || typeof review !== "object") return null;
  const cleanList = (items, maxItems = 6, maxChars = 500) =>
    Array.isArray(items) ? items.slice(0, maxItems).map((item) => stringValue(item, maxChars)).filter(Boolean) : [];
  const components = review.components && typeof review.components === "object" ? review.components : {};
  const metrics = review.metrics && typeof review.metrics === "object" ? review.metrics : {};
  const structure = review.structure && typeof review.structure === "object" ? review.structure : {};
  return {
    version: numberValue(review.version, 1),
    status: stringValue(review.status || "complete", 40),
    provider: stringValue(review.provider, 80),
    model: stringValue(review.model, 160),
    createdAt: stringValue(review.createdAt || new Date().toISOString(), 80),
    transcriptHash: stringValue(review.transcriptHash, 120),
    score: Math.max(0, Math.min(100, Math.round(numberValue(review.score, 0)))),
    combinedScore: Math.max(0, Math.min(100, Math.round(numberValue(review.combinedScore ?? review.score, 0)))),
    verdict: stringValue(review.verdict, 80),
    components: {
      fillerScore: numberValue(components.fillerScore, 0),
      clarityScore: numberValue(components.clarityScore, 0),
      structureScore: numberValue(components.structureScore, 0),
      durationScore: numberValue(components.durationScore, 0),
      confidenceScore: numberValue(components.confidenceScore, 0),
    },
    metrics: {
      duration: numberValue(metrics.duration, 0),
      fpm: numberValue(metrics.fpm, 0),
      wpm: numberValue(metrics.wpm, 0),
      totalFillers: numberValue(metrics.totalFillers, 0),
      transcriptChars: numberValue(metrics.transcriptChars, 0),
    },
    hedgingCount: numberValue(review.hedgingCount, 0),
    metricPlacement: stringValue(review.metricPlacement, 40),
    structure: {
      opening: Boolean(structure.opening),
      body: Boolean(structure.body),
      close: Boolean(structure.close),
    },
    jargonFlags: cleanList(review.jargonFlags, 5, 140),
    lengthVerdict: stringValue(review.lengthVerdict, 40),
    diagnosis: stringValue(review.diagnosis, 300),
    strengths: cleanList(review.strengths, 4, 240),
    fixes: cleanList(review.fixes, 5, 260),
    betterAnswer: stringValue(review.betterAnswer, 2500),
    nextDrill: stringValue(review.nextDrill, 500),
  };
};

const sanitizeSession = (raw = {}) => {
  const sessionId = cleanId(raw.sessionId || raw.id);
  if (!sessionId) throw new Error("Missing session id");
  const fillerCounts = sanitizeFillerCounts(raw.fillerCounts || {});
  const totalFillers = Object.values(fillerCounts).reduce((sum, value) => sum + value, 0);
  const createdAtDate = toDate(raw.createdAtIso || raw.createdAt);
  return {
    id: sessionId,
    sessionId,
    jobId: raw.jobId ? cleanDocId(raw.jobId) : null,
    questionId: cleanId(raw.questionId),
    questionText: stringValue(raw.questionText, 1000),
    questionModelAnswer: stringValue(raw.questionModelAnswer, 5000),
    category: stringValue(raw.category, 80),
    transcript: stringValue(raw.transcript, 50000),
    webSpeechTranscript: stringValue(raw.webSpeechTranscript || raw.transcript, 50000),
    whisperTranscript: raw.whisperTranscript ? stringValue(raw.whisperTranscript, 50000) : "",
    whisperModel: raw.whisperModel ? stringValue(raw.whisperModel, 200) : "",
    transcriptionSource: raw.transcriptionSource || "web_speech",
    transcriptPending: Boolean(raw.transcriptPending) && !stringValue(raw.transcript, 50000).trim(),
    audioCaptured: Boolean(raw.audioCaptured || raw.audioRef),
    rescored: Boolean(raw.rescored),
    rescoredAt: raw.rescoredAt || "",
    duration: Math.max(0, numberValue(raw.duration, 0)),
    fillerCounts,
    totalFillers,
    fpm: numberValue(raw.fpm, 0),
    wpm: numberValue(raw.wpm, 0),
    baseScore: Math.max(0, Math.min(100, Math.round(numberValue(raw.baseScore ?? raw.score, 0)))),
    score: Math.max(0, Math.min(100, Math.round(numberValue(raw.score, 0)))),
    phase3Score: raw.phase3Score == null ? null : Math.max(0, Math.min(100, Math.round(numberValue(raw.phase3Score, 0)))),
    scoreType: raw.scoreType ? stringValue(raw.scoreType, 80) : "filler_score",
    topFiller: raw.topFiller ? stringValue(raw.topFiller, 80) : null,
    speechReview: sanitizeReview(raw.speechReview),
    aiReview: sanitizeAiReview(raw.aiReview),
    audioRef: raw.audioRef ? stringValue(raw.audioRef, 500) : null,
    createdAt: admin.firestore.Timestamp.fromDate(createdAtDate),
    createdAtIso: createdAtDate.toISOString(),
    device: stringValue(raw.device, 1000),
    interrupted: Boolean(raw.interrupted),
    queuedOffline: Boolean(raw.queuedOffline),
    smokeTest: Boolean(raw.smokeTest),
    source: "Speech Coach",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
};

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

const updateQuestionStats = async (db, session) => {
  if (!session.questionId) return;
  const questionRef = db.collection(QUESTION_COLLECTION).doc(session.questionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(questionRef);
    const data = snap.exists ? snap.data() || {} : {};
    const previousTimes = numberValue(data.timesAsked, 0);
    const previousAvg = numberValue(data.avgScore, 0);
    const nextTimes = previousTimes + 1;
    const nextAvg = ((previousAvg * previousTimes) + session.score) / nextTimes;
    tx.set(questionRef, {
      timesAsked: nextTimes,
      avgScore: Number(nextAvg.toFixed(1)),
      lastAskedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") return withCors({ error: "Method not allowed" }, 405);

  try {
    const payload = JSON.parse(event.body || "{}");
    const session = sanitizeSession(payload.session || payload);
    const db = getFirestore();
    await db.collection(SESSION_COLLECTION).doc(session.id).set(session, { merge: true });
    await updateQuestionStats(db, session);
    const practiceStats = await recomputePracticeStats(db, session.jobId);
    return withCors({ ok: true, session: serializeSession(session.id, session), practiceStats });
  } catch (error) {
    console.error("speech-session-save error", error);
    return withCors({ error: error.message || "Session save failed" }, 500);
  }
};
