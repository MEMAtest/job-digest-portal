const { getFirestore } = require("./firebase_admin");

const db = getFirestore();

async function main() {
  const snap = await db.collection("jobs").where("application_status", "==", "applied").get();
  console.log(`Total applied: ${snap.size}`);
  snap.forEach((doc) => {
    const d = doc.data();
    const date = (d.application_date || "").slice(0, 10) || "no date";
    console.log(`  - ${d.role} @ ${d.company} (${date})`);
  });
  process.exit(0);
}
main();
