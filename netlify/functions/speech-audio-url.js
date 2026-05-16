const { getFirestore, getStorageBucket, getStorageBucketCandidates } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "GET") return withCors({ error: "Method not allowed" }, 405);

  try {
    const audioRef = String(event.queryStringParameters?.audioRef || "").trim();
    if (!audioRef || audioRef.includes("..") || (!audioRef.startsWith("speech-audio/") && !audioRef.startsWith("firestore-audio/"))) {
      return withCors({ error: "Invalid audioRef" }, 400);
    }

    if (audioRef.startsWith("firestore-audio/")) {
      const sessionId = audioRef.slice("firestore-audio/".length);
      const snap = await getFirestore().collection("session_audio").doc(sessionId).get();
      if (!snap.exists) return withCors({ error: "Audio not found" }, 404);
      const data = snap.data() || {};
      if (!data.audioBase64 || !data.contentType) return withCors({ error: "Audio data incomplete" }, 404);
      return withCors({
        ok: true,
        url: `data:${data.contentType};base64,${data.audioBase64}`,
        storageFallback: true,
        bytes: data.bytes || 0,
      });
    }

    const candidates = getStorageBucketCandidates();
    let lastError = null;
    for (const bucketName of candidates) {
      try {
        const bucket = getStorageBucket(bucketName);
        const file = bucket.file(audioRef);
        const [exists] = await file.exists();
        if (!exists) continue;
        const [url] = await file.getSignedUrl({
          action: "read",
          expires: Date.now() + 15 * 60 * 1000,
        });
        return withCors({ ok: true, url, expiresInSeconds: 900 });
      } catch (error) {
        lastError = error;
        console.warn(`speech audio signed URL failed for bucket ${bucketName}`, error.message);
      }
    }
    if (lastError) throw lastError;
    return withCors({ error: "Audio not found" }, 404);
  } catch (error) {
    console.error("speech-audio-url error", error);
    return withCors({ error: error.message || "Audio URL failed" }, 500);
  }
};
