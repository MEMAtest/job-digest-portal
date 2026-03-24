const { getFirestore } = require("./firebase_admin");

const db = getFirestore();

async function main() {
  const snap = await db.collection("jobs")
    .where("application_status", "==", "ready_to_apply")
    .get();

  if (snap.empty) { console.log("No roles ready to apply."); process.exit(0); }

  console.log(`\n${snap.size} role(s) ready to apply:\n`);
  snap.forEach(doc => {
    const d = doc.data();
    const found = d.created_at || d.scraped_at || d.date_found || d.posted_at || "unknown";
    console.log(`[${d.fit_score || "?"}] ${d.role} — ${d.company}`);
    console.log(`    Found/added: ${found}`);
    console.log(`    ${d.link || "no link"}`);
    console.log();
  });
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
