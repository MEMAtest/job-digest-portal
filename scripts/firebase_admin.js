const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

function extractEnvValue(raw, key) {
  const pattern = new RegExp(`${key}=(.*?)(?:\\n[A-Z0-9_]+=|\\n*$)`, "s");
  const match = raw.match(pattern);
  return match ? match[1].trim() : "";
}

function loadServiceAccount() {
  const directJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (directJson) {
    return JSON.parse(directJson);
  }

  const directB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (directB64) {
    return JSON.parse(Buffer.from(directB64, "base64").toString("utf8"));
  }

  const directPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (directPath && fs.existsSync(directPath)) {
    return JSON.parse(fs.readFileSync(directPath, "utf8"));
  }

  const envCandidates = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const raw = fs.readFileSync(envPath, "utf8");

    const jsonValue = extractEnvValue(raw, "FIREBASE_SERVICE_ACCOUNT_JSON");
    if (jsonValue) {
      return JSON.parse(jsonValue);
    }

    const b64Value = extractEnvValue(raw, "FIREBASE_SERVICE_ACCOUNT_B64");
    if (b64Value) {
      return JSON.parse(Buffer.from(b64Value, "base64").toString("utf8"));
    }

    const pathValue = extractEnvValue(raw, "FIREBASE_SERVICE_ACCOUNT_PATH");
    if (pathValue && fs.existsSync(pathValue)) {
      return JSON.parse(fs.readFileSync(pathValue, "utf8"));
    }
  }

  const localServiceAccountPath = path.join(__dirname, "service_account.json");
  if (fs.existsSync(localServiceAccountPath)) {
    return JSON.parse(fs.readFileSync(localServiceAccountPath, "utf8"));
  }

  throw new Error(
    "Firebase credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_B64, or FIREBASE_SERVICE_ACCOUNT_PATH.",
  );
}

function getFirestore() {
  if (!admin.apps.length) {
    const credentials = loadServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
  }
  return admin.firestore();
}

module.exports = { getFirestore };
