const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { getFirestore } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const QUESTION_COLLECTION = "questionBank";

const toIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const loadSeedQuestions = () => {
  const filePath = path.join(__dirname, "..", "..", "speech-questions.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const normalizeQuestion = (question) => ({
  id: String(question.id || ""),
  text: String(question.text || ""),
  category: String(question.category || "behavioural"),
  roleTag: Array.isArray(question.roleTag) ? question.roleTag : [],
  companyTag: Array.isArray(question.companyTag) ? question.companyTag : [],
  modelAnswer: String(question.modelAnswer || ""),
  modelAnswerVersion: Number(question.modelAnswerVersion || 0),
  timesAsked: Number(question.timesAsked || 0),
  avgScore: Number(question.avgScore || 0),
  lastAskedAt: question.lastAskedAt || null,
});

const serializeQuestionDoc = (doc) => {
  const data = doc.data() || {};
  return {
    id: doc.id,
    text: data.text || "",
    category: data.category || "behavioural",
    roleTag: Array.isArray(data.roleTag) ? data.roleTag : [],
    companyTag: Array.isArray(data.companyTag) ? data.companyTag : [],
    modelAnswer: data.modelAnswer || "",
    modelAnswerVersion: Number(data.modelAnswerVersion || 0),
    timesAsked: Number(data.timesAsked || 0),
    avgScore: Number(data.avgScore || 0),
    lastAskedAt: toIso(data.lastAskedAt),
  };
};

const loadNormalizedSeed = () => loadSeedQuestions().map(normalizeQuestion).filter((question) => question.id && question.text);

const seedIfEmpty = async (db) => {
  const existing = await db.collection(QUESTION_COLLECTION).limit(1).get();
  if (!existing.empty) return false;
  const seed = loadNormalizedSeed();
  const batchSize = 450;
  for (let start = 0; start < seed.length; start += batchSize) {
    const batch = db.batch();
    seed.slice(start, start + batchSize).forEach((question) => {
      batch.set(db.collection(QUESTION_COLLECTION).doc(question.id), {
        ...question,
        lastAskedAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  return true;
};

const syncSeedMetadata = async (db) => {
  const seed = loadNormalizedSeed();
  const snap = await db.collection(QUESTION_COLLECTION).get();
  const existingById = new Map(snap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const pending = seed.filter((question) => {
    const existing = existingById.get(question.id) || {};
    return (
      existing.text !== question.text ||
      existing.category !== question.category ||
      existing.modelAnswer !== question.modelAnswer ||
      Number(existing.modelAnswerVersion || 0) !== Number(question.modelAnswerVersion || 0)
    );
  });

  const batchSize = 450;
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = db.batch();
    pending.slice(start, start + batchSize).forEach((question) => {
      batch.set(
        db.collection(QUESTION_COLLECTION).doc(question.id),
        {
          text: question.text,
          category: question.category,
          roleTag: question.roleTag,
          companyTag: question.companyTag,
          modelAnswer: question.modelAnswer,
          modelAnswerVersion: question.modelAnswerVersion,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();
  }
  return pending.length;
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "GET") return withCors({ error: "Method not allowed" }, 405);

  try {
    const db = getFirestore();
    const seeded = await seedIfEmpty(db);
    const synced = seeded ? 0 : await syncSeedMetadata(db);
    const seedIds = new Set(loadNormalizedSeed().map((question) => question.id));
    const snap = await db.collection(QUESTION_COLLECTION).get();
    const questions = snap.docs
      .map(serializeQuestionDoc)
      .filter((question) => seedIds.has(question.id) || question.modelAnswer)
      .sort((left, right) => `${left.category}:${left.text}`.localeCompare(`${right.category}:${right.text}`));
    return withCors({ ok: true, seeded, synced, questions });
  } catch (error) {
    console.error("speech-question-bank error", error);
    return withCors({ error: error.message || "Question bank failed" }, 500);
  }
};
