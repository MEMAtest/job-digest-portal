import {
  state,
  dashboardStatsContainer,
  sourceStatsContainer,
  roleSuggestionsContainer,
  candidatePrepContainer,
  followUpBanner,
  triagePrompt,
  db,
  collectionName,
  doc,
  updateDoc,
  formatInlineText,
  formatList,
  escapeHtml,
  parseDateValue,
  safeLocalStorageGet,
  safeLocalStorageSet,
  getTodayKey,
  TRIAGE_PROMPT_THRESHOLD,
  applyQuickFilter,
  showToast,
} from "./app.core.js";
import { openTriageMode } from "./app.triage.js";

export const renderSourceStats = (statsDocs) => {
  if (!statsDocs.length) {
    if (sourceStatsContainer) sourceStatsContainer.innerHTML = "";
    return;
  }
  const latest = statsDocs[0];
  const counts = latest.counts || {};
  const total = latest.total || 0;
  const sevenDayTotal = statsDocs.reduce((acc, doc) => acc + (doc.total || 0), 0);
  const avg = statsDocs.length ? Math.round(sevenDayTotal / statsDocs.length) : 0;

  const cards = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([source, count]) => `
      <div class="stat-card">
        <div class="stat-card__label">${escapeHtml(source)}</div>
        <div class="stat-card__value">${count}</div>
        <div class="stat-card__trend">7‑day avg: ${avg}</div>
      </div>`
    )
    .join("");

  if (sourceStatsContainer) {
    sourceStatsContainer.innerHTML = `
      <div class="stat-card">
        <div class="stat-card__label">Total (today)</div>
        <div class="stat-card__value">${total}</div>
        <div class="stat-card__trend">7‑day total: ${sevenDayTotal}</div>
      </div>
      ${cards}
    `;
  }
};

export const renderRoleSuggestions = (doc) => {
  if (!doc || !doc.roles || !doc.roles.length) {
    roleSuggestionsContainer.classList.add("hidden");
    roleSuggestionsContainer.innerHTML = "";
    return;
  }
  roleSuggestionsContainer.classList.remove("hidden");
  roleSuggestionsContainer.innerHTML = `
    <div class="section-title">Adjacent roles to consider</div>
    <div>${formatList(doc.roles)}</div>
    <div style="margin-top:8px;">${formatInlineText(doc.rationale || "")}</div>
  `;
};

export const renderCandidatePrep = (doc) => {
  if (!doc) {
    candidatePrepContainer.classList.add("hidden");
    candidatePrepContainer.innerHTML = "";
    return;
  }
  candidatePrepContainer.classList.remove("hidden");
  candidatePrepContainer.innerHTML = `
    <div class="section-title">Your interview cheat sheet</div>
    <div><strong>Quick pitch</strong></div>
    <div>${formatInlineText(doc.quick_pitch || "Not available yet.")}</div>
    <div style="margin-top:8px;"><strong>Key stats</strong></div>
    ${formatList(doc.key_stats || [])}
    <div style="margin-top:8px;"><strong>Key talking points</strong></div>
    ${formatList(doc.key_talking_points || [])}
    <div style="margin-top:8px;"><strong>Strengths to emphasise</strong></div>
    ${formatList(doc.strengths || [])}
    <div style="margin-top:8px;"><strong>Risk mitigations</strong></div>
    ${formatList(doc.risk_mitigations || [])}
    <div style="margin-top:8px;"><strong>STAR stories (10/10)</strong></div>
    ${formatList(doc.star_stories || [])}
    <div style="margin-top:8px;"><strong>Interview questions to rehearse</strong></div>
    ${formatList(doc.interview_questions || [])}
  `;
};

export const renderDashboardStats = (jobs) => {
  if (!dashboardStatsContainer) return;

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const last24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last72 = new Date(now.getTime() - 72 * 60 * 60 * 1000);

  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();
  const updatedDates = jobs.map((job) => parseDateValue(job.updated_at)).filter(Boolean);

  const newLast24 = updatedDates.filter((dt) => dt >= last24).length;
  const newLast72 = updatedDates.filter((dt) => dt >= last72).length;

  const appliedToday = jobs.filter((job) => {
    if (safeStatus(job) !== "applied") return false;
    const dt = parseDateValue(job.application_date);
    return dt && dt >= startToday;
  }).length;

  const appliedYesterday = jobs.filter((job) => {
    if (safeStatus(job) !== "applied") return false;
    const dt = parseDateValue(job.application_date);
    return dt && dt >= startYesterday && dt < startToday;
  }).length;

  const savedCount = jobs.filter((job) => safeStatus(job) === "saved").length;
  const shortlistedCount = jobs.filter((job) => safeStatus(job) === "shortlisted").length;
  const readyToApplyCount = jobs.filter((job) => safeStatus(job) === "ready_to_apply").length;
  const interviewCount = jobs.filter((job) => safeStatus(job) === "interview").length;
  const offerCount = jobs.filter((job) => safeStatus(job) === "offer").length;
  const uniqueCompanies = new Set(jobs.map((job) => job.company).filter(Boolean)).size;

  dashboardStatsContainer.innerHTML = `
    <div class="stat-card stat-card--clickable" data-stat="links">
      <div class="stat-card__label">Links sent</div>
      <div class="stat-card__value">${jobs.length}</div>
      <div class="stat-card__trend">Live roles in feed</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="new24">
      <div class="stat-card__label">New (24h)</div>
      <div class="stat-card__value">${newLast24}</div>
      <div class="stat-card__trend">Updated in last day</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="new72">
      <div class="stat-card__label">New (72h)</div>
      <div class="stat-card__value">${newLast72}</div>
      <div class="stat-card__trend">Updated in last 3 days</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="appliedToday">
      <div class="stat-card__label">Applied today</div>
      <div class="stat-card__value">${appliedToday}</div>
      <div class="stat-card__trend">Since midnight</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="appliedYesterday">
      <div class="stat-card__label">Applied yesterday</div>
      <div class="stat-card__value">${appliedYesterday}</div>
      <div class="stat-card__trend">Previous day</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="saved">
      <div class="stat-card__label">Saved</div>
      <div class="stat-card__value">${savedCount}</div>
      <div class="stat-card__trend">Tap to triage</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="shortlisted">
      <div class="stat-card__label">Shortlisted</div>
      <div class="stat-card__value">${shortlistedCount}</div>
      <div class="stat-card__trend">Worth a closer look</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="readyToApply">
      <div class="stat-card__label">Ready to Apply</div>
      <div class="stat-card__value">${readyToApplyCount}</div>
      <div class="stat-card__trend">Open Apply Hub</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="interview">
      <div class="stat-card__label">Interviews</div>
      <div class="stat-card__value">${interviewCount}</div>
      <div class="stat-card__trend">Active</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="offer">
      <div class="stat-card__label">Offers</div>
      <div class="stat-card__value">${offerCount}</div>
      <div class="stat-card__trend">Win rate tracker</div>
    </div>
    <div class="stat-card stat-card--clickable" data-stat="uniqueCompanies">
      <div class="stat-card__label">Unique companies</div>
      <div class="stat-card__value">${uniqueCompanies}</div>
      <div class="stat-card__trend">Company spread</div>
    </div>
  `;

  dashboardStatsContainer.querySelectorAll(".stat-card--clickable").forEach((card) => {
    const stat = card.dataset.stat;
    card.addEventListener("click", () => {
      if (stat === "links") {
        applyQuickFilter({ label: "All roles", predicate: null, status: "" });
        return;
      }
      if (stat === "new24") {
        applyQuickFilter({
          label: "Updated in last 24 hours",
          predicate: (job) => {
            const dt = parseDateValue(job.updated_at);
            return dt && dt >= last24;
          },
        });
        return;
      }
      if (stat === "new72") {
        applyQuickFilter({
          label: "Updated in last 72 hours",
          predicate: (job) => {
            const dt = parseDateValue(job.updated_at);
            return dt && dt >= last72;
          },
        });
        return;
      }
      if (stat === "appliedToday") {
        applyQuickFilter({
          label: "Applied today",
          status: "applied",
          predicate: (job) => {
            const dt = parseDateValue(job.application_date);
            return dt && dt >= startToday;
          },
        });
        return;
      }
      if (stat === "appliedYesterday") {
        applyQuickFilter({
          label: "Applied yesterday",
          status: "applied",
          predicate: (job) => {
            const dt = parseDateValue(job.application_date);
            return dt && dt >= startYesterday && dt < startToday;
          },
        });
        return;
      }
      if (stat === "saved") {
        const savedJobs = jobs.filter((j) => safeStatus(j) === "saved");
        if (savedJobs.length > 0) {
          openTriageMode(savedJobs);
        } else {
          applyQuickFilter({ label: "Saved roles", status: "saved" });
        }
        return;
      }
      if (stat === "shortlisted") {
        applyQuickFilter({ label: "Shortlisted roles", status: "shortlisted" });
        return;
      }
      if (stat === "readyToApply") {
        if (state.handlers.setActiveTab) state.handlers.setActiveTab("top");
        return;
      }
      if (stat === "interview") {
        applyQuickFilter({ label: "Interview stage", status: "interview" });
        return;
      }
      if (stat === "offer") {
        applyQuickFilter({ label: "Offers", status: "offer" });
        return;
      }
      if (stat === "uniqueCompanies") {
        applyQuickFilter({ label: "Unique companies", uniqueCompanies: true });
        return;
      }
    });
  });
};

export const renderPipelineView = (jobs) => {
  const container = document.getElementById("pipeline-view");
  if (!container) return;

  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();
  const statuses = ["saved", "shortlisted", "ready_to_apply", "applied", "interview", "offer", "rejected"];
  const labels = {
    saved: "Saved",
    shortlisted: "Shortlisted",
    ready_to_apply: "Ready to Apply",
    applied: "Applied",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
  };
  const groups = {};
  statuses.forEach((s) => (groups[s] = []));
  jobs.forEach((job) => {
    const s = safeStatus(job);
    if (groups[s]) groups[s].push(job);
  });

  container.innerHTML = `
    <div class="section-title" style="margin-bottom:12px;">Pipeline</div>
    <div class="pipeline-columns">
      ${statuses
        .map(
          (s) => `
        <div class="pipeline-col" data-pipeline-status="${s}">
          <div class="pipeline-col__header">${labels[s]} <span class="pipeline-col__count">(${groups[s].length})</span></div>
          <div class="pipeline-col__jobs">
            ${groups[s]
              .slice(0, 8)
              .map(
                (job) =>
                  `<div class="pipeline-job" data-job-id="${escapeHtml(job.id)}"><div class="pipeline-job__role">${escapeHtml(job.role)}</div><div class="pipeline-job__company">${escapeHtml(job.company)}</div></div>`
              )
              .join("")}
            ${groups[s].length > 8 ? `<div class="pipeline-job__more">+${groups[s].length - 8} more</div>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll(".pipeline-col").forEach((col) => {
    col.addEventListener("click", () => {
      const s = col.dataset.pipelineStatus;
      applyQuickFilter({ label: `${labels[s]} roles`, status: s });
    });
  });
};

export const renderFollowUps = (jobs) => {
  const container = document.getElementById("follow-ups");
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const safeStatus = (job) => (job.application_status || "saved").toLowerCase();

  const overdue = jobs
    .filter((job) => {
      const s = safeStatus(job);
      if (s === "rejected" || s === "offer") return false;
      const dt = parseDateValue(job.follow_up_date);
      return dt && dt <= today;
    })
    .sort((a, b) => {
      const da = parseDateValue(a.follow_up_date);
      const db2 = parseDateValue(b.follow_up_date);
      return (da || 0) - (db2 || 0);
    });

  if (!overdue.length) {
    container.innerHTML = "";
    return;
  }

  const daysDiff = (date) => {
    const diff = today - date;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  container.innerHTML = `
    <div class="section-title" style="margin-bottom:12px;">Follow-ups Due</div>
    <div class="follow-ups-list">
      ${overdue
        .map((job) => {
          const dt = parseDateValue(job.follow_up_date);
          const days = daysDiff(dt);
          const label = days === 0 ? "Due today" : `${days}d overdue`;
          return `<div class="follow-up-card" data-job-id="${escapeHtml(job.id)}">
            <div class="follow-up-card__role">${escapeHtml(job.role)}</div>
            <div class="follow-up-card__company">${escapeHtml(job.company)}</div>
            <div class="follow-up-card__overdue">${label}</div>
            <button class="follow-up-card__snooze" data-job-id="${escapeHtml(job.id)}">Snooze 1 day</button>
          </div>`;
        })
        .join("")}
    </div>
  `;

  container.querySelectorAll(".follow-up-card").forEach((el) => {
    el.addEventListener("click", () => {
      const jobId = el.dataset.jobId;
      if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
      setTimeout(() => {
        const target = document.querySelector(`#carousel-${jobId}`)?.closest(".job-card");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    });
  });

  container.querySelectorAll(".follow-up-card__snooze").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const current = parseDateValue(job.follow_up_date) || new Date();
      const next = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      const nextIso = `${next.toISOString().slice(0, 10)}T00:00:00.000Z`;
      try {
        if (db) {
          await updateDoc(doc(db, collectionName, jobId), {
            follow_up_date: nextIso,
            updated_at: new Date().toISOString(),
          });
        }
        job.follow_up_date = nextIso;
        renderFollowUps(state.jobs);
        renderFollowUpBanner(state.jobs);
        showToast("Follow-up snoozed");
      } catch (error) {
        console.error("Snooze failed:", error);
        showToast("Snooze failed");
      }
    });
  });
};

export const renderFollowUpBanner = (jobs) => {
  if (!followUpBanner) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = jobs.filter((job) => {
    const status = (job.application_status || "saved").toLowerCase();
    if (status === "rejected" || status === "offer") return false;
    const dt = parseDateValue(job.follow_up_date);
    return dt && dt <= today;
  });

  if (!overdue.length) {
    followUpBanner.classList.add("hidden");
    followUpBanner.innerHTML = "";
    return;
  }

  followUpBanner.classList.remove("hidden");
  followUpBanner.innerHTML = `
    <div>
      <strong>${overdue.length} follow-up${overdue.length > 1 ? "s" : ""} due</strong>
      <span class="banner__sub">Keep momentum on active applications.</span>
    </div>
    <div class="banner__actions">
      <button class="btn btn-secondary banner-view-followups">View</button>
    </div>
  `;

  const viewBtn = followUpBanner.querySelector(".banner-view-followups");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      applyQuickFilter({
        label: "Follow-ups due",
        predicate: (job) => {
          const status = (job.application_status || "saved").toLowerCase();
          if (status === "rejected" || status === "offer") return false;
          const dt = parseDateValue(job.follow_up_date);
          return dt && dt <= today;
        },
      });
      if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
    });
  }
};

export const triggerFollowUpNotifications = (jobs) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const todayKey = getTodayKey();
  const notifiedRaw = safeLocalStorageGet("followup_notified") || "{}";
  let notified = {};
  try {
    notified = JSON.parse(notifiedRaw) || {};
  } catch (error) {
    notified = {};
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  jobs.forEach((job) => {
    const status = (job.application_status || "saved").toLowerCase();
    if (status === "rejected" || status === "offer") return;
    const dt = parseDateValue(job.follow_up_date);
    if (!dt || dt > today) return;
    const key = `${job.id}-${todayKey}`;
    if (notified[key]) return;
    new Notification(`Follow up: ${job.company}`, {
      body: `${job.role} — due now`,
    });
    notified[key] = true;
  });
  safeLocalStorageSet("followup_notified", JSON.stringify(notified));
};

export const renderTriagePrompt = (jobs) => {
  if (!triagePrompt) return;
  const savedCount = jobs.filter((job) => (job.application_status || "saved").toLowerCase() === "saved").length;
  const todayKey = getTodayKey();
  const lastTriage = safeLocalStorageGet("last_triage_date") || "";

  if (savedCount <= TRIAGE_PROMPT_THRESHOLD || lastTriage === todayKey) {
    triagePrompt.classList.add("hidden");
    triagePrompt.innerHTML = "";
    return;
  }

  triagePrompt.classList.remove("hidden");
  triagePrompt.innerHTML = `
    <div>
      <strong>${savedCount} untriaged roles</strong>
      <span class="banner__sub">Triage now? Takes ~5 minutes.</span>
    </div>
    <div class="banner__actions">
      <button class="btn btn-primary banner-triage-start">Start triaging</button>
      <button class="btn btn-tertiary banner-triage-later">Remind me later</button>
    </div>
  `;

  const startBtn = triagePrompt.querySelector(".banner-triage-start");
  const laterBtn = triagePrompt.querySelector(".banner-triage-later");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const triageable = jobs.filter((j) => (j.application_status || "saved").toLowerCase() === "saved");
      safeLocalStorageSet("last_triage_date", todayKey);
      openTriageMode(triageable);
      triagePrompt.classList.add("hidden");
    });
  }
  if (laterBtn) {
    laterBtn.addEventListener("click", () => {
      safeLocalStorageSet("last_triage_date", todayKey);
      triagePrompt.classList.add("hidden");
    });
  }
};

state.handlers.renderDashboardStats = renderDashboardStats;
state.handlers.renderPipelineView = renderPipelineView;
state.handlers.renderFollowUps = renderFollowUps;
state.handlers.renderFollowUpBanner = renderFollowUpBanner;
state.handlers.renderTriagePrompt = renderTriagePrompt;
state.handlers.renderRoleSuggestions = renderRoleSuggestions;
state.handlers.renderSourceStats = renderSourceStats;
state.handlers.renderCandidatePrep = renderCandidatePrep;
