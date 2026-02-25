const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// Load FIREBASE_SERVICE_ACCOUNT_JSON from scripts/.env
const envPath = path.join(__dirname, ".env");
const envContent = fs.readFileSync(envPath, "utf8");
const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.*?)(?:\n[A-Z]|\n*$)/s);
if (!match) {
  console.error("No FIREBASE_SERVICE_ACCOUNT_JSON found in .env");
  process.exit(1);
}

const serviceJson = match[1].trim();
const creds = JSON.parse(serviceJson);
admin.initializeApp({ credential: admin.credential.cert(creds) });
const db = admin.firestore();

const profilePath = path.join(__dirname, "combined_profile_text.txt");
const profileText = fs.readFileSync(profilePath, "utf8");

db.collection("settings")
  .doc("cv_profile")
  .set({
    text: profileText,
    updated_at: new Date().toISOString(),
  })
  .then(() => {
    console.log(`CV profile stored in Firestore: settings/cv_profile (${profileText.length} chars)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  });
