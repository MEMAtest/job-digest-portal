const { getFirestore } = require("./firebase_admin");

const db = getFirestore();

async function main() {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // last 48 hours
  const cutoffIso = cutoff.toISOString();

  const snap = await db.collection("jobs")
    .where("created_at", ">=", cutoffIso)
    .get();

  if (snap.empty) {
    console.log(`No jobs added since ${cutoffIso} — scraper may still be running.`);
    process.exit(0);
  }

  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

  console.log(`\n${jobs.length} jobs added today (${cutoffIso}):\n`);
  jobs.forEach(d => {
    console.log(`[${d.fit_score || "?"}] ${d.role} — ${d.company} (${d.application_status || "?"})`);
    console.log(`    ${d.link || ""}`);
    console.log();
  });
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
