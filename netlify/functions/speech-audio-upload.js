const { getStorageBucket, getStorageBucketCandidates } = require("./_firebase");
const { withCors, handleOptions } = require("./_cors");

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
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

    const audioRef = `speech-audio/${sessionId}.webm`;
    const candidates = getStorageBucketCandidates();
    let lastError = null;
    for (const bucketName of candidates) {
      try {
        const bucket = getStorageBucket(bucketName);
        await bucket.file(audioRef).save(buffer, {
          resumable: false,
          metadata: {
            contentType,
            metadata: { sessionId, createdBy: "speech-coach" },
          },
        });
        return withCors({ ok: true, audioRef, bucket: bucketName, bytes: buffer.length });
      } catch (error) {
        lastError = error;
        console.warn(`speech audio upload failed for bucket ${bucketName}`, error.message);
      }
    }
    throw lastError || new Error("No Firebase Storage bucket candidates available");
  } catch (error) {
    console.error("speech-audio-upload error", error);
    return withCors({ error: error.message || "Audio upload failed" }, 500);
  }
};
