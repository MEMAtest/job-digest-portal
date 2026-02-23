const admin = require("firebase-admin");

const getFirestore = () => {
  if (admin.apps.length) {
    return admin.firestore();
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  admin.initializeApp({
    credential: admin.credential.cert(creds),
  });

  return admin.firestore();
};

module.exports = { getFirestore };
