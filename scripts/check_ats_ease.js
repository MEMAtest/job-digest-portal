#!/usr/bin/env node
/**
 * check_ats_ease.js
 *
 * For every shortlisted/saved role in Firestore:
 *   1. Detects ATS from URL pattern (instant, no scraping)
 *   2. Hits public Greenhouse / Lever JSON APIs to confirm job is live + check easy-apply
 *   3. Rates application ease: Easy / Medium / Hard
 *   4. Prints a summary table
 */

const https = require("https");
const http = require("http");
const { getFirestore } = require("./firebase_admin");

const db = getFirestore();

// ── ATS detection ────────────────────────────────────────────────────────────
const ATS_PATTERNS = [
  // Easy Apply platforms
  { pattern: /linkedin\.com\/jobs/i,           ats: "LinkedIn",           ease: "Easy",   notes: "Easy Apply (1-click)" },
  { pattern: /linkedin\.com/i,                  ats: "LinkedIn",           ease: "Easy",   notes: "Easy Apply (1-click)" },
  { pattern: /indeed\.com/i,                    ats: "Indeed",             ease: "Easy",   notes: "Indeed Easy Apply available" },
  { pattern: /glassdoor\.com/i,                 ats: "Glassdoor",          ease: "Easy",   notes: "Glassdoor Easy Apply" },
  // Medium — ATS with standard forms
  { pattern: /boards\.greenhouse\.io/i,         ats: "Greenhouse",         ease: "Medium", notes: "Upload CV + short form, no login required" },
  { pattern: /greenhouse\.io/i,                 ats: "Greenhouse",         ease: "Medium", notes: "Upload CV + short form, no login required" },
  { pattern: /jobs\.lever\.co/i,                ats: "Lever",              ease: "Medium", notes: "Upload CV + short form, no login required" },
  { pattern: /lever\.co/i,                      ats: "Lever",              ease: "Medium", notes: "Upload CV + short form, no login required" },
  { pattern: /apply\.workable\.com/i,           ats: "Workable",           ease: "Medium", notes: "Account or social login, ~5-10 min form" },
  { pattern: /jobs\.ashbyhq\.com/i,             ats: "Ashby",              ease: "Medium", notes: "Upload CV, short form, no login" },
  { pattern: /ashbyhq\.com/i,                   ats: "Ashby",              ease: "Medium", notes: "Upload CV, short form, no login" },
  { pattern: /smartrecruiters\.com/i,           ats: "SmartRecruiters",    ease: "Medium", notes: "Create account or LinkedIn login, ~10 min" },
  { pattern: /efinancialcareers/i,              ats: "eFinancialCareers",  ease: "Medium", notes: "Account + CV upload + cover letter" },
  { pattern: /jobserve\.com/i,                  ats: "JobServe",           ease: "Medium", notes: "Account required, standard form" },
  { pattern: /totaljobs\.com/i,                 ats: "TotalJobs",          ease: "Medium", notes: "Account or Easy Apply" },
  { pattern: /reed\.co\.uk/i,                   ats: "Reed",               ease: "Medium", notes: "Account + CV upload" },
  { pattern: /cvlibrary\.co\.uk/i,              ats: "CV-Library",         ease: "Medium", notes: "Account + CV upload" },
  // Hard — long multi-step forms or proprietary portals
  { pattern: /myworkdayjobs\.com/i,             ats: "Workday",            ease: "Hard",   notes: "Account required, long multi-step form, ~20-30 min" },
  { pattern: /workday\.com/i,                   ats: "Workday",            ease: "Hard",   notes: "Account required, long multi-step form, ~20-30 min" },
  { pattern: /oraclecloud\.com/i,               ats: "Oracle HCM",         ease: "Hard",   notes: "Account required, long form, ~20-30 min (used by JPMC)" },
  { pattern: /taleo\.net/i,                     ats: "Taleo",              ease: "Hard",   notes: "Older ATS, long form, frequent timeouts" },
  { pattern: /successfactors\.com/i,            ats: "SAP SuccessFactors", ease: "Hard",   notes: "Account required, long form" },
  { pattern: /icims\.com/i,                     ats: "iCIMS",              ease: "Hard",   notes: "Account required, multi-step" },
  { pattern: /brassring\.com/i,                 ats: "BrassRing",          ease: "Hard",   notes: "Legacy ATS, very long form" },
];

function detectATS(link) {
  if (!link) return { ats: "Unknown", ease: "Unknown", notes: "No link provided" };
  for (const p of ATS_PATTERNS) {
    if (p.pattern.test(link)) return { ats: p.ats, ease: p.ease, notes: p.notes };
  }
  // Heuristic: company careers pages
  if (/careers\.|\/careers\//i.test(link)) {
    return { ats: "Company Portal", ease: "Medium", notes: "Direct careers page — ATS unknown, likely medium" };
  }
  return { ats: "Unknown", ease: "Unknown", notes: link };
}

// ── Public API checks ─────────────────────────────────────────────────────────
function fetchJson(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, data: null }); }
      });
    });
    req.on("error", () => resolve({ ok: false, status: 0, data: null }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, data: null }); });
  });
}

function extractGreenhouseSlug(link) {
  // boards.greenhouse.io/{slug}/jobs/{id}  OR  greenhouse.io/companies/{slug}/jobs/{id}
  const m = link.match(/boards\.greenhouse\.io\/([^/]+)/i) ||
            link.match(/greenhouse\.io\/companies\/([^/]+)/i) ||
            link.match(/greenhouse\.io\/([^/]+)\/jobs/i);
  return m ? m[1] : null;
}

function extractGreenhouseJobId(link) {
  const m = link.match(/\/jobs\/(\d+)/i);
  return m ? m[1] : null;
}

function extractLeverSlug(link) {
  // jobs.lever.co/{slug}/{uuid}
  const m = link.match(/jobs\.lever\.co\/([^/]+)/i);
  return m ? m[1] : null;
}

function extractLeverJobId(link) {
  const m = link.match(/jobs\.lever\.co\/[^/]+\/([a-f0-9-]{36})/i);
  return m ? m[1] : null;
}

async function enrichWithAPI(link, atsInfo) {
  const extra = { live: null, easyApply: null };

  if (atsInfo.ats === "Greenhouse") {
    const slug = extractGreenhouseSlug(link);
    const jobId = extractGreenhouseJobId(link);
    if (slug && jobId) {
      const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`);
      if (r.ok && r.data) {
        extra.live = true;
        extra.title = r.data.title;
        // Greenhouse has no "easy apply" — it's always a form but no login needed
        extra.notes = `Live on Greenhouse. No login needed — upload CV + fill form (~5 min)`;
      } else if (r.status === 404) {
        extra.live = false;
        extra.notes = `⚠ Job may be closed (404 from Greenhouse API)`;
      }
    } else if (slug) {
      // Check the board exists
      const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      extra.live = r.ok;
    }
  }

  if (atsInfo.ats === "Lever") {
    const slug = extractLeverSlug(link);
    const jobId = extractLeverJobId(link);
    if (slug && jobId) {
      const r = await fetchJson(`https://api.lever.co/v0/postings/${slug}/${jobId}`);
      if (r.ok && r.data) {
        extra.live = true;
        extra.title = r.data.text;
        extra.notes = `Live on Lever. No login needed — upload CV + short form (~5 min)`;
      } else if (r.status === 404) {
        extra.live = false;
        extra.notes = `⚠ Job may be closed (404 from Lever API)`;
      }
    }
  }

  return extra;
}

// ── Formatting ────────────────────────────────────────────────────────────────
const EASE_EMOJI = { Easy: "🟢", Medium: "🟡", Hard: "🔴", Unknown: "⚪" };

function pad(str, len) {
  const s = String(str ?? "");
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\nFetching pipeline roles from Firestore…");

  const snap = await db.collection("jobs")
    .where("application_status", "in", ["shortlisted", "shortlist", "saved"])
    .get();

  if (snap.empty) {
    console.log("No shortlisted/saved roles found.");
    process.exit(0);
  }

  // Filter to non-applied, scored roles
  const roles = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.fit_score || b.score || 0) - (a.fit_score || a.score || 0));

  console.log(`Found ${roles.length} unactioned roles. Checking ATS…\n`);

  const results = [];

  for (const job of roles) {
    const link = job.link || job.url || "";
    const atsInfo = detectATS(link);
    const extra = await enrichWithAPI(link, atsInfo);

    const liveStr = extra.live === true ? " ✓ live" : extra.live === false ? " ✗ closed?" : "";
    const notes = extra.notes || atsInfo.notes;

    results.push({
      score: job.fit_score || job.score || "?",
      company: job.company || "?",
      role: (job.role || job.title || "?").slice(0, 42),
      ats: atsInfo.ats,
      ease: atsInfo.ease,
      live: liveStr,
      notes,
      link,
    });
  }

  // ── Print table ───────────────────────────────────────────────────────────
  console.log("─".repeat(120));
  console.log(
    pad("Fit", 5) +
    pad("Company", 22) +
    pad("Role", 44) +
    pad("ATS", 20) +
    pad("Ease", 10) +
    "Notes"
  );
  console.log("─".repeat(120));

  for (const r of results) {
    const easeIcon = EASE_EMOJI[r.ease] || "⚪";
    console.log(
      pad(`[${r.score}]`, 5) +
      pad(r.company, 22) +
      pad(r.role, 44) +
      pad(r.ats + r.live, 20) +
      pad(easeIcon + " " + r.ease, 10) +
      r.notes
    );
  }

  console.log("─".repeat(120));

  // ── Summary by ease ───────────────────────────────────────────────────────
  const byEase = { Easy: [], Medium: [], Hard: [], Unknown: [] };
  for (const r of results) byEase[r.ease]?.push(r);

  console.log("\n── Summary ──────────────────────────────────────────────────");
  for (const [ease, roles] of Object.entries(byEase)) {
    if (!roles.length) continue;
    console.log(`\n${EASE_EMOJI[ease]} ${ease} (${roles.length} role${roles.length > 1 ? "s" : ""}):`);
    for (const r of roles) {
      console.log(`   [${r.score}] ${r.company} — ${r.role}`);
      console.log(`         ${r.link || "no link"}`);
    }
  }

  console.log("\n── How to act ───────────────────────────────────────────────");
  console.log("🟢 Easy   = apply now via LinkedIn/Indeed (< 2 min each)");
  console.log("🟡 Medium = 5-15 min form, no login or simple login required");
  console.log("🔴 Hard   = 20-30 min Workday/Oracle form, create account first");
  console.log();

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
