const { getFirestore } = require("./firebase_admin");

const db = getFirestore();

async function getByStatus(status) {
  const snap = await db.collection("jobs").where("application_status", "==", status).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function main() {
  const [shortlisted, newRoles] = await Promise.all([
    getByStatus("shortlisted"),
    getByStatus("new"),
  ]);

  // Sort by fit_score desc
  const sort = arr => arr.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

  console.log(`\n=== SHORTLISTED (${shortlisted.length}) ===`);
  sort(shortlisted).forEach(d => {
    console.log(`[${d.fit_score || "?"}] ${d.role} — ${d.company}`);
    console.log(`    Added: ${d.created_at || "unknown"}`);
    console.log(`    ${d.link || ""}`);
    console.log();
  });

  console.log(`\n=== NEW / UNREVIEWED top 80+ fit score (${newRoles.filter(d => (d.fit_score||0) >= 80).length}) ===`);
  sort(newRoles).filter(d => (d.fit_score || 0) >= 80).forEach(d => {
    console.log(`[${d.fit_score || "?"}] ${d.role} — ${d.company}`);
    console.log(`    Added: ${d.created_at || "unknown"}`);
    console.log(`    ${d.link || ""}`);
    console.log();
  });

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
