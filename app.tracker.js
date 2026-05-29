// Application Tracker tab
//
// Reads jobs + application_events from Firestore, computes the funnel
// (Applied → Response → Interview → Offer) for a configurable cohort
// (default: from 2026-03-01, the real campaign start) and renders four
// views: funnel chart, pipeline list, rejection breakdown, 30-day activity
// + industry benchmarks. No chart library — all bars are pure CSS.

import * as core from "./app.core.js";
import {
  collection,
  query,
  orderBy,
  getDocs,
  limit,
  initializeApp,
  getFirestore,
  initializeFirestore,
  setDb,
} from "./app.core.js";

const COHORT_START = "2026-03-01";
const TRACKER_TAB_ID = "tracker";

// Senior-PM / Director / Product Owner UK fintech benchmarks
// (sources: SmartRecruiters UK 2025, Huntr Q2 2025, Greenhouse 2026,
//  Standout-CV UK, CareerPlug 2025).
const BENCHMARKS = {
  response: { low: 10, high: 15, label: "App → response" },
  interview: { low: 5, high: 10, label: "App → first interview" },
  offer: { low: 15, high: 25, label: "Interview → offer" },
  endToEnd: { low: 1, high: 3, label: "End-to-end (app → offer)" },
};

let renderInFlight = false;

const fmtPct = (numerator, denominator) => {
  if (!denominator) return "—";
  return `${Math.round((100 * numerator) / denominator)}%`;
};

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : "—");

const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const verdictBadge = (rate, benchmark) => {
  if (rate === null) return `<span class="tracker-badge tracker-badge--mute">live</span>`;
  if (rate >= benchmark.high * 1.5) return `<span class="tracker-badge tracker-badge--good">+++ well above</span>`;
  if (rate >= benchmark.high) return `<span class="tracker-badge tracker-badge--good">+ above</span>`;
  if (rate >= benchmark.low) return `<span class="tracker-badge tracker-badge--ok">on benchmark</span>`;
  if (rate >= benchmark.low * 0.5) return `<span class="tracker-badge tracker-badge--warn">below</span>`;
  return `<span class="tracker-badge tracker-badge--bad">--- critical</span>`;
};

const ensureStyles = () => {
  if (document.getElementById("tracker-tab-styles")) return;
  const style = document.createElement("style");
  style.id = "tracker-tab-styles";
  style.textContent = `
    .tracker-content { display: flex; flex-direction: column; gap: 24px; }
    .tracker-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; }
    .tracker-section h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; color: #0f172a; }
    .tracker-section p.tracker-meta { margin: 0 0 14px; color: #475569; font-size: 0.9rem; }
    .tracker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .tracker-stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
    .tracker-stat__label { color: #64748b; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .tracker-stat__value { font-size: 1.6rem; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .tracker-stat__sub { font-size: 0.78rem; color: #64748b; margin-top: 2px; }
    .tracker-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
    .tracker-badge--good { background: #dcfce7; color: #166534; }
    .tracker-badge--ok { background: #dbeafe; color: #1e40af; }
    .tracker-badge--warn { background: #fef3c7; color: #92400e; }
    .tracker-badge--bad { background: #fee2e2; color: #991b1b; }
    .tracker-badge--mute { background: #e5e7eb; color: #374151; }
    .tracker-funnel { display: flex; flex-direction: column; gap: 10px; }
    .tracker-funnel__row { display: grid; grid-template-columns: 180px 1fr 90px; gap: 12px; align-items: center; }
    .tracker-funnel__label { color: #334155; font-size: 0.9rem; }
    .tracker-funnel__bar { background: #f1f5f9; border-radius: 6px; overflow: hidden; height: 26px; position: relative; }
    .tracker-funnel__fill { background: linear-gradient(90deg, #0ea5e9, #38bdf8); height: 100%; min-width: 4px; }
    .tracker-funnel__fill--reject { background: linear-gradient(90deg, #ef4444, #f87171); }
    .tracker-funnel__fill--success { background: linear-gradient(90deg, #16a34a, #22c55e); }
    .tracker-funnel__count { text-align: right; color: #0f172a; font-weight: 600; }
    .tracker-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .tracker-table th, .tracker-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .tracker-table th { color: #475569; font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; background: #f8fafc; }
    .tracker-table tr:hover td { background: #f8fafc; }
    .tracker-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
    .tracker-pill--applied { background: #e0f2fe; color: #075985; }
    .tracker-pill--interview { background: #fef3c7; color: #92400e; }
    .tracker-pill--offer { background: #dcfce7; color: #14532d; }
    .tracker-pill--rejected { background: #fee2e2; color: #991b1b; }
    .tracker-spark { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; align-items: end; height: 80px; }
    .tracker-spark__bar { background: #cbd5e1; border-radius: 2px 2px 0 0; min-height: 2px; position: relative; }
    .tracker-spark__bar--hot { background: #0ea5e9; }
    .tracker-spark__bar--rej { background: #ef4444; }
    .tracker-spark__date { font-size: 0.65rem; color: #94a3b8; }
    .tracker-spark-wrap { display: flex; flex-direction: column; gap: 4px; }
    .tracker-spark-legend { display: flex; gap: 14px; font-size: 0.78rem; color: #475569; }
    .tracker-spark-legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
    .tracker-spark-legend .leg-hot::before { background: #0ea5e9; }
    .tracker-spark-legend .leg-rej::before { background: #ef4444; }
    .tracker-spark-legend .leg-mute::before { background: #cbd5e1; }
    .tracker-bench-row { display: grid; grid-template-columns: 200px 80px 1fr 110px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .tracker-bench-row:last-child { border-bottom: 0; }
    .tracker-bench__metric { color: #334155; font-size: 0.9rem; }
    .tracker-bench__your { font-weight: 700; color: #0f172a; }
    .tracker-bench__bm { color: #64748b; font-size: 0.85rem; }
    .tracker-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .tracker-controls input[type="date"] { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; }
    .tracker-controls button { padding: 6px 12px; border: 1px solid #0ea5e9; background: #0ea5e9; color: #fff; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
    .tracker-controls button.secondary { background: #fff; color: #0ea5e9; }
    .tracker-empty { color: #64748b; padding: 16px; text-align: center; font-size: 0.9rem; }
  `;
  document.head.appendChild(style);
};

// Detect Safari (matches app.bootstrap.js logic) so we use the polling
// transport that the rest of the portal uses on Safari.
const isSafariBrowser = () => {
  const ua = navigator.userAgent || "";
  return /safari/i.test(ua) && !/chrome|crios|android|edge|edg/i.test(ua);
};

function ensureFirestore() {
  // Bootstrap may have already initialised this. Read the live binding.
  if (core.db) return core.db;
  if (!window.FIREBASE_CONFIG) {
    throw new Error("Missing Firebase config (config.js). Refresh the page or check your network.");
  }
  const app = initializeApp(window.FIREBASE_CONFIG);
  const firestore = isSafariBrowser()
    ? initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false })
    : getFirestore(app);
  setDb(firestore);
  return firestore;
}

async function fetchData() {
  const fs = ensureFirestore();
  const colName = core.collectionName || "jobs";
  const jobsSnap = await getDocs(
    query(collection(fs, colName), orderBy("updated_at", "desc"), limit(2000))
  );
  const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  let events = [];
  try {
    const evSnap = await getDocs(
      query(collection(fs, "application_events"), orderBy("received_at", "desc"), limit(500))
    );
    events = evSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // application_events read may fail if the Firestore rules haven't been
    // deployed for this collection. Surface the issue without breaking the
    // rest of the tracker.
    console.warn("[tracker] application_events read failed:", err);
  }

  return { jobs, events };
}

function classifyJob(job, eventsByJob) {
  const status = (job.application_status || "").toLowerCase();
  const ownEvents = eventsByJob.get(job.id) || [];
  const hadInterview =
    ownEvents.some((e) => e.event_type === "interview_invite") ||
    status === "interview" ||
    status === "offer" ||
    job.last_event_type === "interview_invite" ||
    !!job.interview_stage_reached;
  return { status, hadInterview };
}

function computeStats(jobs, events, cohortStart) {
  const eventsByJob = new Map();
  for (const ev of events) {
    if (!ev.matched_job_id) continue;
    if (!eventsByJob.has(ev.matched_job_id)) eventsByJob.set(ev.matched_job_id, []);
    eventsByJob.get(ev.matched_job_id).push(ev);
  }

  const active = jobs.filter((j) => {
    const status = (j.application_status || "").toLowerCase();
    return ["applied", "interview", "offer", "rejected"].includes(status);
  });

  const cohort = active.filter((j) => {
    const appDate = (j.application_date || "").slice(0, 10);
    return appDate && appDate >= cohortStart;
  });

  const preCohort = active.filter((j) => {
    const appDate = (j.application_date || "").slice(0, 10);
    return appDate && appDate < cohortStart;
  });

  const noDate = active.filter((j) => !(j.application_date || "").slice(0, 10));

  const bucket = (list) => {
    const out = {
      total: list.length,
      applied: [],
      interview: [],
      offer: [],
      rejected_cv: [],
      rejected_post_interview: [],
    };
    for (const job of list) {
      const { status, hadInterview } = classifyJob(job, eventsByJob);
      if (status === "applied") out.applied.push(job);
      else if (status === "interview") out.interview.push(job);
      else if (status === "offer") out.offer.push(job);
      else if (status === "rejected") {
        if (hadInterview) out.rejected_post_interview.push(job);
        else out.rejected_cv.push(job);
      }
    }
    return out;
  };

  return {
    cohort: bucket(cohort),
    preCohort: bucket(preCohort),
    noDate: bucket(noDate),
    cohortJobs: cohort,
    preCohortJobs: preCohort,
    activeJobs: active,
    events,
    eventsByJob,
  };
}

function renderFunnel(stats) {
  const c = stats.cohort;
  const totalApps = c.total;
  if (!totalApps) {
    return `<div class="tracker-empty">No applications recorded in cohort window.</div>`;
  }

  const reachedInterview = c.interview.length + c.offer.length + c.rejected_post_interview.length;
  const anyResponse =
    c.interview.length + c.offer.length + c.rejected_cv.length + c.rejected_post_interview.length;
  const offers = c.offer.length;

  const responseRate = (100 * anyResponse) / totalApps;
  const interviewRate = (100 * reachedInterview) / totalApps;
  const resolvedInterviews = c.offer.length + c.rejected_post_interview.length;
  const offerRate = resolvedInterviews ? (100 * offers) / resolvedInterviews : null;
  const endToEndRate = (100 * offers) / totalApps;

  const bar = (count, total, cls = "") => {
    const pct = total ? (100 * count) / total : 0;
    return `<div class="tracker-funnel__bar"><div class="tracker-funnel__fill ${cls}" style="width:${pct}%"></div></div>`;
  };

  const row = (label, count, total, cls = "") => `
    <div class="tracker-funnel__row">
      <div class="tracker-funnel__label">${escapeHtml(label)}</div>
      ${bar(count, total, cls)}
      <div class="tracker-funnel__count">${count} <span style="color:#64748b;font-weight:400;font-size:0.8rem">${fmtPct(count, total)}</span></div>
    </div>`;

  return `
    <div class="tracker-funnel">
      ${row("Applications", totalApps, totalApps)}
      ${row("Any response", anyResponse, totalApps)}
      ${row("Reached interview", reachedInterview, totalApps)}
      ${row("Offers", offers, totalApps, "tracker-funnel__fill--success")}
    </div>
    <div class="tracker-grid" style="margin-top:18px">
      <div class="tracker-stat">
        <div class="tracker-stat__label">Response rate</div>
        <div class="tracker-stat__value">${fmtPct(anyResponse, totalApps)}</div>
        <div class="tracker-stat__sub">${anyResponse} / ${totalApps}</div>
      </div>
      <div class="tracker-stat">
        <div class="tracker-stat__label">App → interview</div>
        <div class="tracker-stat__value">${fmtPct(reachedInterview, totalApps)}</div>
        <div class="tracker-stat__sub">${reachedInterview} / ${totalApps}</div>
      </div>
      <div class="tracker-stat">
        <div class="tracker-stat__label">Interview → offer</div>
        <div class="tracker-stat__value">${resolvedInterviews ? fmtPct(offers, resolvedInterviews) : "—"}</div>
        <div class="tracker-stat__sub">${offers} / ${resolvedInterviews} resolved ${c.interview.length ? `· ${c.interview.length} live` : ""}</div>
      </div>
      <div class="tracker-stat">
        <div class="tracker-stat__label">End-to-end</div>
        <div class="tracker-stat__value">${fmtPct(offers, totalApps)}</div>
        <div class="tracker-stat__sub">${offers} offers / ${totalApps} apps</div>
      </div>
    </div>
  `;
}

function renderBenchmarks(stats) {
  const c = stats.cohort;
  const totalApps = c.total;
  if (!totalApps) return "";

  const reachedInterview = c.interview.length + c.offer.length + c.rejected_post_interview.length;
  const anyResponse =
    c.interview.length + c.offer.length + c.rejected_cv.length + c.rejected_post_interview.length;
  const resolvedInterviews = c.offer.length + c.rejected_post_interview.length;
  const responseRate = (100 * anyResponse) / totalApps;
  const interviewRate = (100 * reachedInterview) / totalApps;
  const offerRate = resolvedInterviews ? (100 * c.offer.length) / resolvedInterviews : null;
  const endToEndRate = (100 * c.offer.length) / totalApps;

  const row = (metric, rate, benchmark, note = "") => {
    const rateText = rate === null ? "—" : `${rate.toFixed(1)}%`;
    return `
      <div class="tracker-bench-row">
        <div class="tracker-bench__metric">${escapeHtml(metric)}</div>
        <div class="tracker-bench__your">${rateText}</div>
        <div class="tracker-bench__bm">benchmark ${benchmark.low}–${benchmark.high}% ${note ? `· <em>${escapeHtml(note)}</em>` : ""}</div>
        <div>${verdictBadge(rate, benchmark)}</div>
      </div>`;
  };

  return `
    ${row("Application → response", responseRate, BENCHMARKS.response, "UK senior fintech")}
    ${row("Application → first interview", interviewRate, BENCHMARKS.interview, "senior PM / Director")}
    ${row("Interview → offer", offerRate, BENCHMARKS.offer, resolvedInterviews ? "" : "no resolved yet")}
    ${row("End-to-end", endToEndRate, BENCHMARKS.endToEnd, "")}
  `;
}

function renderPipeline(stats) {
  const interviewing = [...stats.cohort.interview, ...stats.preCohort.interview, ...stats.noDate.interview];
  const applied = [
    ...stats.cohort.applied,
    ...stats.preCohort.applied,
    ...stats.noDate.applied,
  ].sort((a, b) => (b.application_date || "").localeCompare(a.application_date || ""));

  if (!interviewing.length && !applied.length) {
    return `<div class="tracker-empty">No live applications.</div>`;
  }

  const rows = [];

  if (interviewing.length) {
    rows.push(`
      <tr><th colspan="4" style="background:#fff8e1;color:#92400e">In Interview (${interviewing.length})</th></tr>
    `);
    for (const j of interviewing) {
      rows.push(`
        <tr>
          <td><span class="tracker-pill tracker-pill--interview">interview</span></td>
          <td>${escapeHtml(j.company || "—")}</td>
          <td>${escapeHtml(j.role || "—")}</td>
          <td>${fmtDate(j.last_event_at) || fmtDate(j.application_date)}</td>
        </tr>
      `);
    }
  }
  if (applied.length) {
    rows.push(`
      <tr><th colspan="4" style="background:#e0f2fe;color:#075985">Applied — Awaiting Response (${applied.length})</th></tr>
    `);
    for (const j of applied) {
      rows.push(`
        <tr>
          <td><span class="tracker-pill tracker-pill--applied">applied</span></td>
          <td>${escapeHtml(j.company || "—")}</td>
          <td>${escapeHtml(j.role || "—")}</td>
          <td>${fmtDate(j.application_date)}</td>
        </tr>
      `);
    }
  }

  return `
    <table class="tracker-table">
      <thead><tr><th>Stage</th><th>Firm</th><th>Role</th><th>Date</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

function renderRejections(stats) {
  const cvAll = [...stats.cohort.rejected_cv, ...stats.preCohort.rejected_cv, ...stats.noDate.rejected_cv];
  const piAll = [
    ...stats.cohort.rejected_post_interview,
    ...stats.preCohort.rejected_post_interview,
    ...stats.noDate.rejected_post_interview,
  ];

  const stageCounts = {};
  for (const j of piAll) {
    const stage = (j.interview_stage_reached || "").toLowerCase();
    let bucket = "post-interview (stage unknown)";
    if (stage.includes("1st") || stage.includes("first") || stage.includes("screen")) bucket = "after 1st stage / screen";
    else if (stage.includes("2nd") || stage.includes("case") || stage.includes("second")) bucket = "after 2nd stage / case";
    else if (stage.includes("final") || stage.includes("panel")) bucket = "after final / panel";
    stageCounts[bucket] = (stageCounts[bucket] || 0) + 1;
  }

  const renderList = (list, kind) =>
    list.length
      ? list
          .sort((a, b) => (b.last_event_at || b.application_date || "").localeCompare(a.last_event_at || a.application_date || ""))
          .map(
            (j) => `
        <tr>
          <td><span class="tracker-pill tracker-pill--rejected">${kind}</span></td>
          <td>${escapeHtml(j.company || "—")}</td>
          <td>${escapeHtml(j.role || "—")}</td>
          <td>${escapeHtml(j.interview_stage_reached || "—")}</td>
          <td>${fmtDate(j.last_event_at) || fmtDate(j.application_date)}</td>
        </tr>`
          )
          .join("")
      : "";

  const stageRows = Object.entries(stageCounts)
    .map(([k, v]) => `<div class="tracker-stat"><div class="tracker-stat__label">${escapeHtml(k)}</div><div class="tracker-stat__value">${v}</div></div>`)
    .join("");

  return `
    <div class="tracker-grid">
      <div class="tracker-stat">
        <div class="tracker-stat__label">CV-stage rejections</div>
        <div class="tracker-stat__value">${cvAll.length}</div>
        <div class="tracker-stat__sub">no interview reached</div>
      </div>
      <div class="tracker-stat">
        <div class="tracker-stat__label">Post-interview rejections</div>
        <div class="tracker-stat__value">${piAll.length}</div>
        <div class="tracker-stat__sub">reached interview then rejected</div>
      </div>
      ${stageRows}
    </div>
    <table class="tracker-table" style="margin-top:16px">
      <thead><tr><th>Stage</th><th>Firm</th><th>Role</th><th>Reached</th><th>When</th></tr></thead>
      <tbody>
        ${renderList(piAll, "post-interview")}
        ${renderList(cvAll, "CV stage")}
      </tbody>
    </table>
  `;
}

function renderActivity(stats) {
  // 30-day timeline of events, grouped by day, colored by event_type
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = [];
  const dateToIndex = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, applied: 0, interview: 0, rejection: 0 });
    dateToIndex[key] = days.length - 1;
  }

  for (const ev of stats.events) {
    const key = (ev.received_at || "").slice(0, 10);
    if (!(key in dateToIndex)) continue;
    const day = days[dateToIndex[key]];
    if (ev.event_type === "application_confirmation") day.applied += 1;
    else if (ev.event_type === "interview_invite") day.interview += 1;
    else if (ev.event_type === "rejection") day.rejection += 1;
  }

  const max = Math.max(1, ...days.map((d) => d.applied + d.interview + d.rejection));

  const bars = days
    .map((d) => {
      const total = d.applied + d.interview + d.rejection;
      const height = Math.max(3, (95 * total) / max);
      const dominant = d.rejection > d.interview && d.rejection > d.applied ? "tracker-spark__bar--rej" :
        d.interview > 0 ? "tracker-spark__bar--hot" : (total > 0 ? "tracker-spark__bar--hot" : "");
      const tooltip = `${d.key}: ${d.applied}A · ${d.interview}I · ${d.rejection}R`;
      return `<div class="tracker-spark__bar ${dominant}" style="height:${height}%" title="${tooltip}"></div>`;
    })
    .join("");

  const totals = days.reduce(
    (acc, d) => ({ a: acc.a + d.applied, i: acc.i + d.interview, r: acc.r + d.rejection }),
    { a: 0, i: 0, r: 0 }
  );

  return `
    <div class="tracker-spark-wrap">
      <div class="tracker-spark">${bars}</div>
      <div class="tracker-spark-legend">
        <span class="leg-hot">Interview / app activity (${totals.i + totals.a})</span>
        <span class="leg-rej">Rejections (${totals.r})</span>
        <span class="leg-mute">Quiet days</span>
      </div>
    </div>
  `;
}

async function renderTracker(container, cohortStart = COHORT_START) {
  if (!container) return;
  if (renderInFlight) return;
  renderInFlight = true;
  ensureStyles();
  container.innerHTML = `<div class="tracker-empty">Loading tracker…</div>`;

  try {
    const { jobs, events } = await fetchData();
    const stats = computeStats(jobs, events, cohortStart);

    container.innerHTML = `
      <div class="tracker-content">

        <div class="tracker-section">
          <div class="tracker-controls">
            <label style="color:#475569;font-size:0.85rem">Cohort start</label>
            <input id="tracker-cohort" type="date" value="${escapeHtml(cohortStart)}" />
            <button id="tracker-refresh" class="secondary">Refresh</button>
            <span style="margin-left:auto;color:#64748b;font-size:0.8rem">
              ${stats.cohort.total} apps in cohort · ${stats.preCohort.total} pre-cohort · ${stats.events.length} events total
            </span>
          </div>
        </div>

        <div class="tracker-section">
          <h3>Funnel — cohort from ${escapeHtml(cohortStart)}</h3>
          ${renderFunnel(stats)}
        </div>

        <div class="tracker-section">
          <h3>vs Industry benchmarks (UK senior fintech / Product Owner)</h3>
          <p class="tracker-meta">Sources: SmartRecruiters UK 2025 · Huntr Q2 2025 · Greenhouse 2026 · Standout-CV UK · CareerPlug 2025</p>
          ${renderBenchmarks(stats)}
        </div>

        <div class="tracker-section">
          <h3>Active pipeline</h3>
          ${renderPipeline(stats)}
        </div>

        <div class="tracker-section">
          <h3>Rejection breakdown</h3>
          ${renderRejections(stats)}
        </div>

        <div class="tracker-section">
          <h3>Last 30 days of inbox activity</h3>
          ${renderActivity(stats)}
        </div>

      </div>
    `;

    const cohortInput = document.getElementById("tracker-cohort");
    const refreshBtn = document.getElementById("tracker-refresh");
    if (refreshBtn && cohortInput) {
      refreshBtn.addEventListener("click", () => {
        renderInFlight = false;
        renderTracker(container, cohortInput.value || COHORT_START);
      });
    }
  } catch (err) {
    console.error("[tracker] render failed", err);
    container.innerHTML = `<div class="tracker-empty">Tracker failed to load: ${escapeHtml(err.message || String(err))}</div>`;
  } finally {
    renderInFlight = false;
  }
}

// ── Bootstrap ───────────────────────────────────────────────
const trackerContainer = document.getElementById("tracker-content");
if (trackerContainer) {
  // Don't render immediately — Firestore is initialised by app.bootstrap.js
  // which loads later. Render lazily on first tab click.
  let firstRender = false;
  const navBtn = document.querySelector(`.nav-item[data-tab="${TRACKER_TAB_ID}"]`);
  if (navBtn) {
    navBtn.addEventListener("click", () => {
      if (!firstRender) {
        firstRender = true;
        renderTracker(trackerContainer);
      }
    });
  }
}
