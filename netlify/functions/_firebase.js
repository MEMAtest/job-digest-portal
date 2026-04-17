const admin = require("firebase-admin");

const parseServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  }
};

const buildStorageBucketCandidates = (creds) => {
  const projectId = creds.project_id || creds.projectId || "";
  const candidates = [
    process.env.FIREBASE_STORAGE_BUCKET,
    creds.storageBucket,
    projectId ? `${projectId}.appspot.com` : "",
    projectId ? `${projectId}.firebasestorage.app` : "",
  ]
    .map((value) => String(value || "").trim().replace(/^gs:\/\//, ""))
    .filter(Boolean);

  return Array.from(new Set(candidates));
};

const initApp = () => {
  if (admin.apps.length) return;

  const creds = parseServiceAccount();
  const storageBucket = buildStorageBucketCandidates(creds)[0];

  admin.initializeApp({
    credential: admin.credential.cert(creds),
    storageBucket,
  });
};

const getFirestore = () => {
  initApp();
  return admin.firestore();
};

const getStorageBucket = (bucketName = "") => {
  initApp();
  const normalized = String(bucketName || "").trim().replace(/^gs:\/\//, "");
  return normalized ? admin.storage().bucket(normalized) : admin.storage().bucket();
};

const getStorageBucketCandidates = () => {
  const creds = parseServiceAccount();
  return buildStorageBucketCandidates(creds);
};

const getFirebaseRuntimeMeta = () => {
  const creds = parseServiceAccount();
  return {
    projectId: creds.project_id || creds.projectId || "",
    clientEmail: creds.client_email || creds.clientEmail || "",
    storageBucketCandidates: buildStorageBucketCandidates(creds),
  };
};

module.exports = { getFirestore, getStorageBucket, getStorageBucketCandidates, getFirebaseRuntimeMeta };
