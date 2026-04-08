import { state, showToast } from "./app.core.js";
import { launchApplyAssistant } from "./app.applyassistant.js";
import { buildTailoredCvHtml, renderPdfFromElement } from "./app.cv.js";

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
  // Try state first; fall back to direct Firestore fetch (jobs may not be loaded yet on fresh page)
  let job = state.jobs?.find((j) => j.id === jobId);
  if (!job) {
    try {
      const r = await fetch(`/.netlify/functions/firestore-get?collection=jobs&id=${encodeURIComponent(jobId)}`);
      const d = await r.json();
      if (d?.data) job = d.data;
    } catch {}
  }
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

const getQualityBadgeHtml = (job) => {
  const qs = job.cv_validation?.quality_status || job.tailored_cv_sections?.quality_status || "";
  const score = job.cv_validation?.quality_score || job.cv_validation?.metrics?.quality_score || "";
  const atsCov = job.ats_keyword_coverage;
  const atsHtml = atsCov
    ? `<span class="aa-badge ${atsCov.score >= 80 ? "aa-badge--approved" : "aa-badge--pending"}" title="ATS keyword coverage">ATS ${atsCov.score}%</span>`
    : "";
  if (qs === "accepted") {
    return `<span class="aa-badge aa-badge--approved" title="AI tailored CV">AI Tailored${score ? ` ${score}/100` : ""}</span>${atsHtml}`;
  }
  if (qs === "fallback_master") {
    return `<span class="aa-badge aa-badge--pending" title="Master CV was used — tailored version was weaker">Master CV</span>${atsHtml}`;
  }
  return atsHtml;
};

const renderApprovedSection = (container, jobs) => {
  const approved = jobs.filter((j) => j.auto_apply_status === "approved");
  container.innerHTML = `
    <div class="aa-section">
      <h3 class="aa-section__title">Approved — Ready to Submit <span class="aa-badge aa-badge--approved">${approved.length}</span></h3>
      ${approved.length > 0 ? `<p class="aa-section__hint"><strong>Open &amp; Fill Form</strong> opens the job in a browser and pre-fills all fields using your tailored CV — you review and click Submit yourself. Or use <strong>Apply manually</strong> to do it yourself without Playwright.</p>` : ""}
      ${approved.length === 0
        ? '<p class="aa-empty">No approved applications yet.</p>'
        : approved.map((job) => {
          const qualityNotes = Array.isArray(job.tailored_cv_sections?.quality_notes) ? job.tailored_cv_sections.quality_notes : [];
          const atsCov = job.ats_keyword_coverage;
          return `
          <div class="aa-job-card" data-job-id="${escHtml(job.id)}">
            <div class="aa-job-card__info">
              <div class="aa-job-card__role">${escHtml(job.role || "Role")}</div>
              <div class="aa-job-card__company">${escHtml(job.company || "")}${job.fit_score ? ` · ${job.fit_score}/100` : ""}${job.ats_family ? ` · ${escHtml(job.ats_family)}` : ""}</div>
              ${job.auto_apply_decision_at ? `<div class="aa-job-card__meta">Approved ${formatDate(job.auto_apply_decision_at)}</div>` : ""}
              <div class="aa-job-card__badges">${getQualityBadgeHtml(job)}</div>
              ${qualityNotes.length ? `<div class="aa-quality-notes">${qualityNotes.map((n) => `<span>${escHtml(n)}</span>`).join("")}</div>` : ""}
              ${atsCov && atsCov.missing && atsCov.missing.length ? `<div class="aa-ats-missing">Missing keywords: ${escHtml(atsCov.missing.slice(0, 5).join(", "))}${atsCov.missing.length > 5 ? ` +${atsCov.missing.length - 5} more` : ""}</div>` : ""}
            </div>
            <div class="aa-job-card__actions">
              <button class="btn btn-secondary aa-preview-cv-btn" data-job-id="${escHtml(job.id)}">Preview CV</button>
              ${job.link ? `<a href="${escHtml(job.link)}" target="_blank" rel="noopener" class="btn btn-secondary aa-manual-btn" data-job-id="${escHtml(job.id)}">Apply manually</a>` : ""}
              <button class="btn btn-primary aa-fill-btn" data-job-id="${escHtml(job.id)}" title="Opens browser and pre-fills all fields — you review and submit">Open &amp; Fill Form</button>
            </div>
            <div class="aa-cv-preview-panel hidden" data-preview-for="${escHtml(job.id)}"></div>
            <div class="aa-fill-result hidden" data-result-for="${escHtml(job.id)}"></div>
          </div>`;
        }).join("")}
    </div>
  `;

  container.querySelectorAll(".aa-preview-cv-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs?.find((j) => j.id === jobId);
      const panel = container.querySelector(`.aa-cv-preview-panel[data-preview-for="${jobId}"]`);
      if (!panel) return;
      if (!panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        btn.textContent = "Preview CV";
        return;
      }
      if (!job) { showToast("Job data not loaded yet."); return; }
      btn.textContent = "Hide CV";
      panel.classList.remove("hidden");
      panel.innerHTML = '<div class="aa-cv-preview-loading">Loading CV…</div>';
      try {
        const cvEl = buildTailoredCvHtml(job);
        panel.innerHTML = "";
        const wrapper = document.createElement("div");
        wrapper.className = "aa-cv-preview-content";
        wrapper.appendChild(cvEl);
        const dlBtn = document.createElement("button");
        dlBtn.className = "btn btn-secondary aa-cv-dl-btn";
        dlBtn.textContent = "Download PDF";
        dlBtn.addEventListener("click", async () => {
          try {
            const dlEl = buildTailoredCvHtml(job);
            await renderPdfFromElement(dlEl, { filename: `Ade_Omosanya_CV_${job.company || "role"}.pdf` });
          } catch (err) {
            showToast("PDF download failed: " + (err.message || "unknown error"));
          }
        });
        panel.appendChild(wrapper);
        panel.appendChild(dlBtn);
      } catch (err) {
        panel.innerHTML = `<div class="aa-cv-preview-error">Could not render CV: ${escHtml(err.message)}</div>`;
      }
    });
  });

  container.querySelectorAll(".aa-manual-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const jobId = btn.dataset.jobId;
      try {
        await fetch("/.netlify/functions/firestore-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collection: "jobs",
            id: jobId,
            data: { auto_apply_status: "applied", application_status: "applied", updated_at: new Date().toISOString() },
          }),
        });
      } catch {}
    });
  });

  container.querySelectorAll(".aa-fill-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs?.find((j) => j.id === jobId);
      if (!job) { showToast("Job not found."); return; }

      btn.disabled = true;
      btn.textContent = "Checking server…";
      const healthy = await checkServerHealth();
      if (!healthy) {
        showToast("Local Apply Assistant not running. Use 'Apply manually' instead, or start with: npm run apply-assistant");
        btn.disabled = false;
        btn.textContent = "Open & Fill Form";
        return;
      }
      btn.textContent = "Opening browser…";
      const result = await launchApplyAssistant(job, { autoSubmit: false });
      btn.disabled = false;
      btn.textContent = "Open & Fill Form";

      // Show fill results on the card
      if (result) {
        const resultEl = container.querySelector(`.aa-fill-result[data-result-for="${jobId}"]`);
        if (resultEl) {
          const filled = Array.isArray(result.filled) ? result.filled.length : "?";
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : "?";
          const cvUploaded = Array.isArray(result.filled) && result.filled.includes("resume_upload");
          resultEl.innerHTML = `<span class="aa-fill-summary">Filled: ${filled} fields · Skipped: ${skipped} · CV ${cvUploaded ? "uploaded ✓" : "not uploaded"}</span>`;
          resultEl.classList.remove("hidden");
        }
      }
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
    // Delay to let the page render before opening the modal
    setTimeout(() => openNogoModal(nogoId), 800);
  }
};

// Expose handlers on window for inline HTML usage and external modules
window._aaCloseNogoModal = closeNogoModal;
window._aaSaveNogoReason = saveNogoReason;
window._aaRenderQueue = async () => {
  const container = document.getElementById("auto-apply-queue-container");
  if (!container) return;
  // Refresh state.jobs from the server before re-rendering so newly queued jobs appear
  try {
    const res = await fetch("/.netlify/functions/jobs?limit=200");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.jobs) && data.jobs.length > 0) {
        state.jobs = data.jobs;
      }
    }
  } catch {}
  renderAutoApplyQueue(container);
};
