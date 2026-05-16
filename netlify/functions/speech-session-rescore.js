const admin = require("firebase-admin");
const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const SESSION_COLLECTION = "sessions";
const JOB_COLLECTION = process.env.FIREBASE_COLLECTION || "jobs";
const FILLER_DEFINITIONS = [
  { key: "kind of", pattern: /\bkind\s+of\b/gi },
  { key: "obviously", pattern: /\bobviously\b/gi },
  { key: "I think", pattern: /\bi\s+(?:kind\s+of\s+|sort\s+of\s+)?think\b/gi },
  { key: "probably", pattern: /\bprobably\b/gi },
  { key: "maybe", pattern: /\bmaybe\b/gi },
  { key: "you know", pattern: /\byou\s+know\b/gi },
  { key: "sort of", pattern: /\bsort\s+of\b/gi },
  { key: "I guess", pattern: /\bi\s+guess\b/gi },
  { key: "essentially", pattern: /\bessentially\b/gi },
  { key: "to be honest", pattern: /\bto\s+be\s+honest\b/gi },
  { key: "I'd say", pattern: /\bi['’]?d\s+say\b/gi },
];
const FILLER_KEYS = [...FILLER_DEFINITIONS.map((item) => item.key), "like"];

const cleanId = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
const numberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const emptyCounts = () => Object.fromEntries(FILLER_KEYS.map((key) => [key, 0]));
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
const countWords = (text) => {
  const matches = String(text || "").trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g);
  return matches ? matches.length : 0;
};
const pushMatch = (matches, filler, start, end, text) => {
  if (start < 0 || end <= start) return;
  matches.push({ filler, start, end, text: text.slice(start, end) });
};
const detectLikeMatches = (text) => {
  const matches = [];
  const patterns = [
    /\b(?:i|he|she|it|we|they|you)\s+(?:was|were|am|are)\s+like\b/gi,
    /\bit['’]?s\s+like\b/gi,
    /(?:^|[.!?,;:]\s+|\band\s+|\bso\s+)like\b(?=\s*(?:,|\b(?:i|you)\b|[.!?]|$))/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const matched = match[0] || "";
      const localIndex = matched.toLowerCase().lastIndexOf("like");
      if (localIndex < 0) continue;
      const start = (match.index || 0) + localIndex;
      pushMatch(matches, "like", start, start + 4, text);
    }
  }
  return matches;
};
const dedupeMatches = (matches) => {
  const seen = new Set();
  return matches
    .filter((match) => {
      const key = `${match.filler}:${match.start}:${match.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.start - right.start || right.end - left.end);
};
const detectFillers = (text) => {
  const source = String(text || "");
  const counts = emptyCounts();
  let matches = [];
  for (const definition of FILLER_DEFINITIONS) {
    definition.pattern.lastIndex = 0;
    for (const match of source.matchAll(definition.pattern)) {
      pushMatch(matches, definition.key, match.index || 0, (match.index || 0) + match[0].length, source);
    }
  }
  matches = matches.concat(detectLikeMatches(source));
  const deduped = dedupeMatches(matches);
  for (const match of deduped) counts[match.filler] += 1;
  return { counts, total: deduped.length };
};
const calculateScore = ({ duration = 0, totalFillers = 0, transcript = "" }) => {
  const durationSeconds = Math.max(0, numberValue(duration, 0));
  const minutes = Math.max(durationSeconds / 60, 1 / 60);
  const words = countWords(transcript);
  const fpm = totalFillers / minutes;
  const wpm = words / minutes;
  let score = 100;
  score -= Math.max(0, fpm - 2) * 8;
  if (durationSeconds > 100) score -= 5;
  if (durationSeconds < 30) score -= 8;
  if (wpm < 100) score -= 5;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    fpm: Number(fpm.toFixed(2)),
    wpm: Number(wpm.toFixed(0)),
  };
};
const getTopFiller = (counts = {}) => {
  let top = null;
  for (const key of FILLER_KEYS) {
    const value = numberValue(counts[key], 0);
    if (value <= 0) continue;
    if (!top || value > top.count) top = { filler: key, count: value };
  }
  return top;
};
const serializeSession = (id, data = {}) => ({
  id,
  sessionId: data.sessionId || id,
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
    const transcript = stringValue(payload.transcript || payload.whisperTranscript || "").trim();
    const model = stringValue(payload.model || "onnx-community/whisper-tiny.en", 200);
    if (!sessionId) return withCors({ error: "Missing session id" }, 400);
    if (!transcript) return withCors({ error: "Missing transcript" }, 400);

    const db = getFirestore();
    const ref = db.collection(SESSION_COLLECTION).doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists) return withCors({ error: "Session not found" }, 404);
    const existing = snap.data() || {};
    const detected = detectFillers(transcript);
    const scoreData = calculateScore({ duration: existing.duration, totalFillers: detected.total, transcript });
    const top = getTopFiller(detected.counts);
    const rescoredAt = new Date().toISOString();
    const update = {
      transcript,
      whisperTranscript: transcript,
      whisperModel: model,
      transcriptionSource: "whisper",
      rescored: true,
      rescoredAt,
      fillerCounts: detected.counts,
      totalFillers: detected.total,
      fpm: scoreData.fpm,
      wpm: scoreData.wpm,
      score: scoreData.score,
      topFiller: top?.filler || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(update, { merge: true });
    const updated = { ...existing, ...update };
    const practiceStats = await recomputePracticeStats(db, existing.jobId || null);
    return withCors({ ok: true, session: serializeSession(sessionId, updated), practiceStats });
  } catch (error) {
    console.error("speech-session-rescore error", error);
    return withCors({ error: error.message || "Session rescore failed" }, 500);
  }
};
