const admin = require("firebase-admin");

const initApp = () => {
  if (admin.apps.length) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || creds.storageBucket || "jobsapp-3a2e2.firebasestorage.app";

  admin.initializeApp({
    credential: admin.credential.cert(creds),
    storageBucket,
  });
};

const getFirestore = () => {
  initApp();
  return admin.firestore();
};

const getStorageBucket = () => {
  initApp();
  return admin.storage().bucket();
};

module.exports = { getFirestore, getStorageBucket };
