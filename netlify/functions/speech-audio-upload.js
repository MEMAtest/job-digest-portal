const admin = require("firebase-admin");
const { getFirestore, getStorageBucket, getStorageBucketCandidates } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_FIRESTORE_AUDIO_BYTES = 720 * 1024;
const FIRESTORE_AUDIO_CHUNK_CHARS = 650 * 1024;
const cleanId = (value) => String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);

const getHeader = (headers = {}, name) => {
  const lower = name.toLowerCase();
  const found = Object.keys(headers).find((key) => key.toLowerCase() === lower);
  return found ? headers[found] : "";
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") return withCors({ error: "Method not allowed" }, 405);

  try {
    const sessionId = cleanId(getHeader(event.headers, "x-session-id") || event.queryStringParameters?.sessionId);
    if (!sessionId) return withCors({ error: "Missing session id" }, 400);
    const contentType = getHeader(event.headers, "content-type") || "audio/webm";
    if (!contentType.toLowerCase().startsWith("audio/")) return withCors({ error: "Unsupported content type" }, 415);
    const buffer = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "binary");
    if (!buffer.length) return withCors({ error: "Empty audio body" }, 400);
    if (buffer.length > MAX_AUDIO_BYTES) return withCors({ error: "Audio file too large" }, 413);

    const storageAudioRef = `speech-audio/${sessionId}.webm`;
    const candidates = getStorageBucketCandidates();
    let lastError = null;
    for (const bucketName of candidates) {
      try {
        const bucket = getStorageBucket(bucketName);
        await bucket.file(storageAudioRef).save(buffer, {
          resumable: false,
          metadata: {
            contentType,
            metadata: { sessionId, createdBy: "speech-coach" },
          },
        });
        return withCors({ ok: true, audioRef: storageAudioRef, bucket: bucketName, bytes: buffer.length });
      } catch (error) {
        lastError = error;
        console.warn(`speech audio upload failed for bucket ${bucketName}`, error.message);
      }
    }

    const audioRef = `firestore-audio/${sessionId}`;
    const db = getFirestore();

    if (buffer.length <= MAX_FIRESTORE_AUDIO_BYTES) {
      await db.collection("session_audio").doc(sessionId).set(
        {
          sessionId,
          contentType,
          encoding: "base64",
          audioBase64: buffer.toString("base64"),
          bytes: buffer.length,
          storageFallback: true,
          storageError: lastError?.message || "No Firebase Storage bucket candidates available",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return withCors({ ok: true, audioRef, storageFallback: true, bytes: buffer.length });
    }

    const base64 = buffer.toString("base64");
    const chunks = [];
    for (let index = 0; index < base64.length; index += FIRESTORE_AUDIO_CHUNK_CHARS) {
      chunks.push(base64.slice(index, index + FIRESTORE_AUDIO_CHUNK_CHARS));
    }
    const batch = db.batch();
    const audioDoc = db.collection("session_audio").doc(sessionId);
    batch.set(
      audioDoc,
      {
        sessionId,
        contentType,
        encoding: "base64",
        chunked: true,
        chunkCount: chunks.length,
        bytes: buffer.length,
        storageFallback: true,
        storageError: lastError?.message || "No Firebase Storage bucket candidates available",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    chunks.forEach((chunk, index) => {
      batch.set(audioDoc.collection("chunks").doc(String(index).padStart(4, "0")), {
        index,
        audioBase64: chunk,
      });
    });
    await batch.commit();
    return withCors({ ok: true, audioRef, storageFallback: true, chunked: true, chunks: chunks.length, bytes: buffer.length });
  } catch (error) {
    console.error("speech-audio-upload error", error);
    return withCors({ error: error.message || "Audio upload failed" }, 500);
  }
};
