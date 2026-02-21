import {
  state,
  db,
  collectionName,
  doc,
  updateDoc,
  showToast,
  showConfirmToast,
  formatFitBadge,
  getLocationBadgeClass,
  formatPosted,
  formatInlineText,
  escapeHtml,
  safeLocalStorageSet,
  getTodayKey,
  formatApplicantBadge,
} from "./app.core.js";

const triageOverlay = document.getElementById("triage-overlay");
const triageContent = document.getElementById("triage-content");
const triageProgress = document.getElementById("triage-progress");
const triageCloseBtn = document.getElementById("triage-close");

export const openTriageMode = (jobs) => {
  const queue = jobs || state.jobs.filter((j) => {
    const s = (j.application_status || "saved").toLowerCase();
    return s === "saved";
  });
  if (!queue.length) {
    showToast("No jobs to triage");
    return;
  }
  state.triageQueue = [...queue];
  state.triageIndex = 0;
  state.triageStats = { dismissed: 0, shortlisted: 0, apply: 0 };
  triageOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderTriageCard();
};

export const closeTriageMode = () => {
  triageOverlay.classList.add("hidden");
  document.body.style.overflow = "";
  state.triageQueue = [];
  state.triageIndex = 0;
  state.triageLastAction = null;
};

const renderTriageCard = () => {
  if (!state.triageQueue || state.triageIndex >= state.triageQueue.length) {
    const stats = state.triageStats || { dismissed: 0, shortlisted: 0, apply: 0 };
    triageContent.innerHTML = `
      <div class="triage-summary">
        <h3>Triage complete</h3>
        <div class="triage-summary__stats">
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.dismissed}</span> Dismissed</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.skipped || 0}</span> Skipped</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.shortlisted}</span> Shortlisted</div>
          <div class="triage-summary__stat"><span class="triage-summary__num">${stats.apply}</span> Ready to Apply</div>
        </div>
        <button class="btn btn-primary triage-done-btn">Done</button>
      </div>
    `;
    const doneBtn = triageContent.querySelector(".triage-done-btn");
    if (doneBtn) doneBtn.addEventListener("click", () => {
      safeLocalStorageSet("last_triage_date", getTodayKey());
      closeTriageMode();
      if (state.handlers.renderJobs) state.handlers.renderJobs();
      if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
    });
    triageProgress.textContent = "Done!";
    return;
  }

  const job = state.triageQueue[state.triageIndex];
  const remaining = state.triageQueue.length - state.triageIndex;
  triageProgress.textContent = `${state.triageIndex + 1} / ${state.triageQueue.length} (${remaining} remaining)`;

  const applicantBadge = formatApplicantBadge(job.applicant_count);

  triageContent.innerHTML = `
    <div class="triage-card" id="triage-active-card">
      <div class="triage-card__badges">
        <span class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</span>
        <span class="${getLocationBadgeClass(job.location)}">${escapeHtml(job.location || "Unknown")}</span>
        ${applicantBadge}
      </div>
      <h3 class="triage-card__role">${escapeHtml(job.role)}</h3>
      <p class="triage-card__company">${escapeHtml(job.company)}</p>
      <p class="triage-card__posted">${escapeHtml(formatPosted(job.posted))}</p>
      <div class="triage-card__summary">${formatInlineText(job.tailored_summary || job.role_summary || "")}</div>
      <div class="triage-card__fit">${formatInlineText(job.why_fit || "")}</div>
      ${job.application_notes ? `<div class="triage-card__note">${escapeHtml(job.application_notes)}</div>` : ""}
      <div class="triage-actions">
        <button class="triage-btn triage-btn--dismiss" data-action="dismiss">Not interested <span class="triage-btn__hint">\u2190</span></button>
        <button class="triage-btn triage-btn--skip" data-action="skip">Skip <span class="triage-btn__hint">Space</span></button>
        <button class="triage-btn triage-btn--maybe" data-action="shortlist">Shortlist <span class="triage-btn__hint">\u2192</span></button>
        <button class="triage-btn triage-btn--apply" data-action="apply">Apply <span class="triage-btn__hint">\u2191</span></button>
      </div>
    </div>
  `;

  const card = triageContent.querySelector("#triage-active-card");
  if (card) {
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let deltaY = 0;
    let swiping = false;
    card.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        deltaX = 0;
        deltaY = 0;
        swiping = true;
        card.style.transition = "none";
      },
      { passive: true }
    );
    card.addEventListener(
      "touchmove",
      (e) => {
        if (!swiping) return;
        deltaX = e.touches[0].clientX - startX;
        deltaY = e.touches[0].clientY - startY;
        const rotate = deltaX * 0.05;
        card.style.transform = `translate(${deltaX}px, ${Math.min(0, deltaY)}px) rotate(${rotate}deg)`;
        card.style.opacity = Math.max(0.5, 1 - Math.abs(deltaX) / 400);
      },
      { passive: true }
    );
    card.addEventListener("touchend", () => {
      if (!swiping) return;
      swiping = false;
      card.style.transition = "transform 0.3s ease, opacity 0.3s ease";
      if (deltaX < -80) {
        handleTriageAction("dismiss");
      } else if (deltaX > 80) {
        handleTriageAction("shortlist");
      } else if (deltaY < -80) {
        handleTriageAction("apply");
      } else {
        card.style.transform = "";
        card.style.opacity = "";
      }
    });
  }
};

const undoTriageAction = async () => {
  const last = state.triageLastAction;
  if (!last) return;

  const { index, job, previousStatus, action } = last;

  if (db) {
    try {
      await updateDoc(doc(db, collectionName, job.id), {
        application_status: previousStatus,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Undo triage failed:", err);
      showToast("Undo failed — check your connection.");
      return;
    }
  }

  job.application_status = previousStatus;

  if (action === "dismiss") state.triageStats.dismissed = Math.max(0, state.triageStats.dismissed - 1);
  else if (action === "shortlist") state.triageStats.shortlisted = Math.max(0, state.triageStats.shortlisted - 1);
  else if (action === "apply") state.triageStats.apply = Math.max(0, state.triageStats.apply - 1);

  state.triageIndex = index;
  state.triageLastAction = null;
  renderTriageCard();
};

let triageActionInFlight = false;

export const handleTriageAction = async (action) => {
  if (triageActionInFlight) return;
  triageActionInFlight = true;

  const job = state.triageQueue[state.triageIndex];
  if (!job) {
    triageActionInFlight = false;
    return;
  }

  const card = triageContent.querySelector("#triage-active-card");

  if (action === "skip") {
    if (card) card.classList.add("triage-card--exit-up");
    state.triageStats.skipped = (state.triageStats.skipped || 0) + 1;
    state.triageIndex++;
    setTimeout(() => {
      triageActionInFlight = false;
      renderTriageCard();
    }, 300);
    return;
  }

  const exitClass =
    action === "dismiss" ? "triage-card--exit-left" : action === "shortlist" ? "triage-card--exit-right" : "triage-card--exit-up";
  if (card) card.classList.add(exitClass);

  const statusMap = { dismiss: "dismissed", shortlist: "shortlisted", apply: "ready_to_apply" };
  const newStatus = statusMap[action];
  const oldStatus = job.application_status || "saved";
  const now = new Date().toISOString();

  state.triageLastAction = { index: state.triageIndex, job, previousStatus: oldStatus, action };

  if (db) {
    try {
      await updateDoc(doc(db, collectionName, job.id), {
        application_status: newStatus,
        updated_at: now,
      });
    } catch (err) {
      console.error("Triage update failed:", err);
    }
  }
  job.application_status = newStatus;

  if (action === "dismiss") state.triageStats.dismissed++;
  else if (action === "shortlist") state.triageStats.shortlisted++;
  else if (action === "apply") state.triageStats.apply++;

  const actionLabels = { dismiss: "Dismissed", shortlist: "Shortlisted", apply: "Ready to Apply" };
  showConfirmToast(actionLabels[action] || "Done", "Undo", undoTriageAction, 4000);

  state.triageIndex++;
  setTimeout(() => {
    triageActionInFlight = false;
    renderTriageCard();
  }, 300);
};

if (triageCloseBtn) {
  triageCloseBtn.addEventListener("click", closeTriageMode);
}

if (triageOverlay) {
  triageOverlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]");
    if (action) handleTriageAction(action.dataset.action);
  });
}

const triageEntryBtn = document.getElementById("triage-btn");
if (triageEntryBtn) {
  triageEntryBtn.addEventListener("click", () => {
    const filtered = state.handlers.getFilteredJobs ? state.handlers.getFilteredJobs() : state.jobs;
    const triageable = filtered.filter((j) => {
      const s = (j.application_status || "saved").toLowerCase();
      return s === "saved";
    });
    openTriageMode(triageable);
  });
}
