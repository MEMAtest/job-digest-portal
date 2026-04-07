import { state, showToast } from "./app.core.js";
import { launchApplyAssistant } from "./app.applyassistant.js";

const LOCAL_ASSISTANT_BASE_URL = "http://127.0.0.1:4319";

const checkServerHealth = async () => {
  const res = await fetch(`${LOCAL_ASSISTANT_BASE_URL}/health`).catch(() => null);
  return res && res.ok;
};

const loadDecisions = async () => {
  try {
    const res = await fetch("/.netlify/functions/firestore-list?collection=auto_apply_decisions&limit=100");
    const json = await res.json();
    return json?.docs || [];
  } catch {
    return [];
  }
};

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
};

const escHtml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const groupNogoReasons = (decisions) => {
  const nogos = decisions.filter((d) => d.decision === "nogo" && d.reason);
  const counts = {};
  nogos.forEach((d) => {
    const key = d.reason.trim().toLowerCase().slice(0, 60);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
};

let nogoModal = null;
let nogoJobId = null;
let nogoDecisionId = null;

const closeNogoModal = () => {
  if (nogoModal) nogoModal.classList.add("hidden");
  const url = new URL(window.location.href);
  url.searchParams.delete("nogo");
  window.history.replaceState({}, "", url.toString());
  nogoJobId = null;
  nogoDecisionId = null;
};

const openNogoModal = async (jobId) => {
  nogoJobId = jobId;
  const job = state.jobs?.find((j) => j.id === jobId);
  const jobLabel = job ? `${escHtml(job.role || "")} @ ${escHtml(job.company || "")}` : escHtml(jobId);

  // Find the decision doc for this job
  try {
    const res = await fetch("/.netlify/functions/firestore-list?collection=auto_apply_decisions&limit=100");
    const json = await res.json();
    const decisionDoc = (json?.docs || []).find((d) => d.jobId === jobId && d.decision === "nogo" && !d.reason);
    if (decisionDoc) nogoDecisionId = decisionDoc.id;
  } catch {}

  const modal = document.getElementById("nogo-modal");
  if (!modal) return;
  nogoModal = modal;

  const titleEl = modal.querySelector("#nogo-modal-job-label");
  const textarea = modal.querySelector("#nogo-reason-text");
  if (titleEl) titleEl.innerHTML = jobLabel;
  if (textarea) textarea.value = "";
  modal.classList.remove("hidden");
};

const saveNogoReason = async () => {
  const textarea = nogoModal?.querySelector("#nogo-reason-text");
  const reason = textarea?.value?.trim() || "";
  if (!nogoDecisionId) {
    closeNogoModal();
    return;
  }
  try {
    await fetch("/.netlify/functions/firestore-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: "auto_apply_decisions",
        id: nogoDecisionId,
        data: { reason, updated_at: new Date().toISOString() },
      }),
    });
    showToast("Reason saved.");
  } catch {
    showToast("Failed to save reason.");
  }
  closeNogoModal();
};

const renderPendingSection = (container, jobs) => {
  const pending = jobs.filter((j) => j.auto_apply_status === "review_pending");
  container.innerHTML = `
    <div class="aa-section">
      <h3 class="aa-section__title">Pending Review <span class="aa-badge aa-badge--pending">${pending.length}</span></h3>
      ${pending.length === 0
        ? '<p class="aa-empty">No applications pending review.</p>'
        : pending.map((job) => `
          <div class="aa-job-card">
            <div class="aa-job-card__info">
              <div class="aa-job-card__role">${escHtml(job.role || "Role")}</div>
              <div class="aa-job-card__company">${escHtml(job.company || "")}${job.fit_score ? ` · ${job.fit_score}/100` : ""}</div>
              ${job.auto_apply_email_sent_at ? `<div class="aa-job-card__meta">Email sent ${formatDate(job.auto_apply_email_sent_at)}</div>` : ""}
            </div>
            <div class="aa-job-card__actions">
              <span class="aa-badge aa-badge--pending">Awaiting decision</span>
            </div>
          </div>`).join("")}
    </div>
  `;
};

const renderApprovedSection = (container, jobs) => {
  const approved = jobs.filter((j) => j.auto_apply_status === "approved");
  container.innerHTML = `
    <div class="aa-section">
      <h3 class="aa-section__title">Approved — Ready to Submit <span class="aa-badge aa-badge--approved">${approved.length}</span></h3>
      ${approved.length === 0
        ? '<p class="aa-empty">No approved applications yet.</p>'
        : approved.map((job) => `
          <div class="aa-job-card">
            <div class="aa-job-card__info">
              <div class="aa-job-card__role">${escHtml(job.role || "Role")}</div>
              <div class="aa-job-card__company">${escHtml(job.company || "")}${job.fit_score ? ` · ${job.fit_score}/100` : ""}</div>
              ${job.auto_apply_decision_at ? `<div class="aa-job-card__meta">Approved ${formatDate(job.auto_apply_decision_at)}</div>` : ""}
            </div>
            <div class="aa-job-card__actions">
              <span class="aa-badge aa-badge--approved">Approved</span>
              <button class="btn btn-primary aa-submit-btn" data-job-id="${escHtml(job.id)}">Submit now</button>
            </div>
          </div>`).join("")}
    </div>
  `;

  container.querySelectorAll(".aa-submit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs?.find((j) => j.id === jobId);
      if (!job) { showToast("Job not found."); return; }

      btn.disabled = true;
      btn.textContent = "Checking server…";
      const healthy = await checkServerHealth();
      if (!healthy) {
        showToast("Local Apply Assistant not running. Start it with: npm run apply-assistant");
        btn.disabled = false;
        btn.textContent = "Submit now";
        return;
      }
      btn.textContent = "Submitting…";
      await launchApplyAssistant(job, { autoSubmit: true });
      btn.disabled = false;
      btn.textContent = "Submit now";
    });
  });
};

const renderHistorySection = (container, decisions) => {
  const patterns = groupNogoReasons(decisions);

  container.innerHTML = `
    <div class="aa-section">
      <h3 class="aa-section__title">Decision History</h3>
      ${decisions.length === 0
        ? '<p class="aa-empty">No decisions recorded yet.</p>'
        : `<div class="aa-history-table-wrap">
            <table class="aa-history-table">
              <thead><tr><th>Date</th><th>Role</th><th>Company</th><th>Decision</th><th>Reason</th></tr></thead>
              <tbody>
                ${decisions.map((d) => `
                  <tr>
                    <td>${formatDate(d.timestamp)}</td>
                    <td>${escHtml(d.job_snapshot?.role || "")}</td>
                    <td>${escHtml(d.job_snapshot?.company || "")}</td>
                    <td><span class="aa-badge ${d.decision === "go" ? "aa-badge--approved" : "aa-badge--rejected"}">${d.decision === "go" ? "GO" : "NO GO"}</span></td>
                    <td>${escHtml(d.reason || "—")}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`}
      ${patterns.length > 0 ? `
        <div class="aa-learning-panel">
          <h4>Patterns from No-Go decisions</h4>
          <ul>
            ${patterns.map(([reason, count]) => `<li>${escHtml(reason)} — <strong>${count} time${count > 1 ? "s" : ""}</strong></li>`).join("")}
          </ul>
        </div>` : ""}
    </div>
  `;
};

export const renderAutoApplyQueue = async (container) => {
  if (!container) return;
  container.innerHTML = '<div class="aa-loading">Loading…</div>';

  const jobs = state.jobs || [];
  const decisions = await loadDecisions();

  const pendingEl = document.createElement("div");
  const approvedEl = document.createElement("div");
  const historyEl = document.createElement("div");

  renderPendingSection(pendingEl, jobs);
  renderApprovedSection(approvedEl, jobs);
  renderHistorySection(historyEl, decisions);

  container.innerHTML = "";
  container.append(pendingEl, approvedEl, historyEl);
};

export const initAutoApplyQueue = () => {
  const container = document.getElementById("auto-apply-queue-container");
  if (container) renderAutoApplyQueue(container);

  // Check for ?nogo= query param
  const params = new URLSearchParams(window.location.search);
  const nogoId = params.get("nogo");
  if (nogoId) {
    // Slight delay to let state load
    setTimeout(() => openNogoModal(nogoId), 500);
  }
};

// Expose close handler on window for inline HTML usage
window._aaCloseNogoModal = closeNogoModal;
window._aaSaveNogoReason = saveNogoReason;
