import {
  state,
  jobsContainer,
  searchInput,
  minFitSelect,
  sourceSelect,
  locationSelect,
  statusSelect,
  ukOnlyCheckbox,
  db,
  collectionName,
  doc,
  updateDoc,
  formatInlineText,
  formatList,
  formatFitBadge,
  getLocationBadgeClass,
  formatPosted,
  formatDismissReason,
  isUkOrRemote,
  escapeHtml,
  copyToClipboard,
  showToast,
  showConfirmToast,
  formatApplicantBadge,
  quickFilterPredicate,
  uniqueCompanyOnly,
} from "./app.core.js";
import { buildPrepQa, openPrepMode } from "./app.prep.js";
import { quickApply } from "./app.applyhub.js";
import { getTailoredCvPlainText, buildTailoredCvHtml, renderPdfFromElement, hasCvTailoredChanges } from "./app.cv.js";

let mobileNavObserver = null;

export const renderFilters = () => {
  if (!sourceSelect || !locationSelect) return;
  sourceSelect.innerHTML = '<option value="">All sources</option>';
  Array.from(state.sources)
    .sort()
    .forEach((source) => {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = source;
      sourceSelect.appendChild(option);
    });

  locationSelect.innerHTML = '<option value="">All locations</option>';
  Array.from(state.locations)
    .sort()
    .forEach((location) => {
      const option = document.createElement("option");
      option.value = location;
      option.textContent = location;
      locationSelect.appendChild(option);
    });
};

export const updateBulkBar = () => {
  let bar = document.querySelector(".bulk-bar");
  const count = state.selectedJobs.size;
  if (count === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "bulk-bar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <span class="bulk-bar__count">${count} selected</span>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="dismiss">Dismiss</button>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="shortlist">Shortlist</button>
    <button class="btn btn-secondary bulk-bar__btn" data-bulk="ready_to_apply">Ready to Apply</button>
    <button class="btn btn-tertiary bulk-bar__btn" data-bulk="clear">Clear</button>
  `;
  bar.querySelectorAll("[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => handleBulkAction(btn.dataset.bulk));
  });
};

const handleBulkAction = async (action) => {
  if (action === "clear") {
    state.selectedJobs.clear();
    document.querySelectorAll(".bulk-check").forEach((cb) => {
      cb.checked = false;
    });
    const selectAll = document.querySelector(".bulk-select-all");
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
    return;
  }

  const ids = [...state.selectedJobs];
  const now = new Date().toISOString();

  for (const jobId of ids) {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) continue;
    job.application_status = action;
    if (db) {
      try {
        await updateDoc(doc(db, collectionName, job.id), {
          application_status: action,
          updated_at: now,
        });
      } catch (err) {
        console.error("Bulk update failed:", err);
      }
    }
  }

  state.selectedJobs.clear();
  updateBulkBar();
  renderJobs();
  if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
  const label = action.replace(/_/g, " ");
  showConfirmToast(
    `${ids.length} job${ids.length > 1 ? "s" : ""} → ${label}`,
    "Undo",
    async () => {
      for (const jobId of ids) {
        const job = state.jobs.find((j) => j.id === jobId);
        if (!job) continue;
        job.application_status = "saved";
        if (db) {
          try {
            await updateDoc(doc(db, collectionName, job.id), {
              application_status: "saved",
              updated_at: new Date().toISOString(),
            });
          } catch (_) {}
        }
      }
      renderJobs();
      if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
      showToast("Undone");
    }
  );
};

export const getFilteredJobs = () => {
  const searchTerm = searchInput.value.toLowerCase();
  const minFit = Number(minFitSelect.value || 0);
  const sourceFilter = sourceSelect.value;
  const locationFilter = locationSelect.value;
  const statusFilter = statusSelect.value;
  const ukOnly = ukOnlyCheckbox.checked;

  let filtered = state.jobs.filter((job) => {
    const jobStatus = (job.application_status || "saved").toLowerCase();
    const matchesSearch =
      !searchTerm ||
      (job.role || "").toLowerCase().includes(searchTerm) ||
      (job.company || "").toLowerCase().includes(searchTerm) ||
      (job.why_fit || "").toLowerCase().includes(searchTerm) ||
      (job.role_summary || "").toLowerCase().includes(searchTerm) ||
      (job.tailored_summary || "").toLowerCase().includes(searchTerm);

    const matchesFit = job.fit_score >= minFit;
    const matchesSource = !sourceFilter || job.source === sourceFilter;
    const matchesLocation = !locationFilter || job.location === locationFilter;
    const matchesStatus = !statusFilter || jobStatus === statusFilter;
    const matchesUkOnly = !ukOnly || isUkOrRemote(job.location);
    const matchesQuick = !quickFilterPredicate || quickFilterPredicate(job);
    const matchesDismissed = statusFilter === "dismissed" || jobStatus !== "dismissed";

    return (
      matchesSearch &&
      matchesFit &&
      matchesSource &&
      matchesLocation &&
      matchesStatus &&
      matchesUkOnly &&
      matchesQuick &&
      matchesDismissed
    );
  });

  if (uniqueCompanyOnly) {
    const seen = new Set();
    filtered = filtered.filter((job) => {
      const key = (job.company || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return filtered;
};

const buildAtsKeywordSection = (job) => {
  const found = job.ats_keywords_found || [];
  const missing = job.ats_keywords_missing || [];
  const coverage = job.ats_keyword_coverage || 0;
  const matched = found.length;
  const missingCount = missing.length;

  if (matched === 0 && missingCount === 0) {
    return '<div style="font-size:12px;color:#64748b;">No ATS data available yet.</div>';
  }

  const badgeColor = coverage >= 70 ? "#059669" : coverage >= 40 ? "#d97706" : "#dc2626";
  const badgeBg = coverage >= 70 ? "#ecfdf5" : coverage >= 40 ? "#fffbeb" : "#fef2f2";

  const pill = (text, color, bg) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:500;color:${color};background:${bg};margin:2px;">${escapeHtml(text)}</span>`;

  const matchedPills = found.map((kw) => pill(kw, "#065f46", "#d1fae5")).join("");
  const missingPills = missing.map((kw) => pill(kw, "#92400e", "#fef3c7")).join("");

  return `
    <div style="margin-bottom:8px;">
      <span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:700;color:${badgeColor};background:${badgeBg};margin-right:8px;">${coverage}%</span>
      <span style="font-size:12px;color:#64748b;">${matched} matched, ${missingCount} missing</span>
    </div>
    ${matched > 0 ? `<div style="margin-bottom:6px;font-size:12px;font-weight:600;color:#059669;">Matched</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${matchedPills}</div>` : ""}
    ${missingCount > 0 ? `<div style="font-size:12px;font-weight:600;color:#d97706;">Missing</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${missingPills}</div>` : ""}
  `;
};

const formatStatusLabel = (statusValue) => {
  if (!statusValue || statusValue === "saved") return "new";
  return statusValue.replace(/_/g, " ");
};

const ensureJobsCvModal = () => {
  if (document.getElementById("jobs-cv-modal")) return;
  const modal = document.createElement("div");
  modal.className = "cv-preview-modal";
  modal.id = "jobs-cv-modal";
  modal.innerHTML = `
    <div class="cv-preview-modal__backdrop"></div>
    <div class="cv-preview-modal__content">
      <div class="cv-preview-modal__header">
        <h3 id="cv-modal-title">CV Preview</h3>
        <button class="cv-preview-modal__close">&times;</button>
      </div>
      <div class="cv-preview-modal__body"></div>
      <div class="cv-preview-modal__actions" style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="cv-modal-download">Download PDF</button>
        <button class="btn btn-secondary" id="cv-modal-copy">Copy as text</button>
        <button class="btn btn-tertiary" id="cv-modal-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.classList.remove("cv-preview-modal--visible");
  modal.querySelector(".cv-preview-modal__backdrop").addEventListener("click", close);
  modal.querySelector(".cv-preview-modal__close").addEventListener("click", close);
  document.getElementById("cv-modal-close").addEventListener("click", close);
};

const openJobsCvModal = (job) => {
  ensureJobsCvModal();
  const modal = document.getElementById("jobs-cv-modal");
  const body = modal.querySelector(".cv-preview-modal__body");
  const title = document.getElementById("cv-modal-title");
  title.textContent = `CV Preview — ${job.company || "Company"}`;
  body.innerHTML = "";
  body.appendChild(buildTailoredCvHtml(job));
  modal.classList.add("cv-preview-modal--visible");

  const downloadBtn = document.getElementById("cv-modal-download");
  const copyBtn = document.getElementById("cv-modal-copy");

  const newDownload = downloadBtn.cloneNode(true);
  downloadBtn.replaceWith(newDownload);
  newDownload.addEventListener("click", async () => {
    const htmlEl = buildTailoredCvHtml(job);
    const companySlug = (job.company || "Company").replace(/[^a-zA-Z0-9]/g, "");
    const options = {
      margin: [10, 15],
      filename: `AdeOmosanya_CV_${companySlug}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4" },
    };
    try {
      showToast("Generating PDF…");
      await renderPdfFromElement(htmlEl, options);
      showToast("PDF ready");
    } catch (err) {
      console.error(err);
      showToast("PDF failed to generate.");
    }
  });

  const newCopy = copyBtn.cloneNode(true);
  copyBtn.replaceWith(newCopy);
  newCopy.addEventListener("click", () => {
    copyToClipboard(getTailoredCvPlainText(job));
  });
};

const renderJobDetail = (job, detailEl) => {
  if (!job || !detailEl) return;

  const bulletList = formatList(job.tailored_cv_bullets || []);
  const requirementsList = formatList(job.key_requirements || []);
  const talkingPoints = formatList(job.key_talking_points || []);
  const starStories = formatList(job.star_stories || []);
  const prepQaBlocks = buildPrepQa(job);
  const scorecardList = formatList(job.scorecard || []);
  const statusValue = (job.application_status || "saved").toLowerCase();
  const statusLabel = formatStatusLabel(statusValue);
  const appliedDate = job.application_date ? job.application_date.slice(0, 10) : "";
  const lastTouchDate = job.last_touch_date ? job.last_touch_date.slice(0, 10) : "";
  const dismissNote = statusValue === "dismissed" ? formatDismissReason(job.dismiss_reason) : "";
  const postedDisplay = job.posted_raw || job.posted || job.posted_date || "";
  const applicantDisplay = job.applicant_count ? `${job.applicant_count} applicants` : "";
  const openStatus =
    job.job_status ||
    (job.is_open === true ? "Open" : "") ||
    (job.is_open === false ? "Closed" : "") ||
    (job.is_closed ? "Closed" : "");
  const metaParts = [formatPosted(postedDisplay), job.source, applicantDisplay, openStatus].filter(Boolean);
  const metaLine = metaParts.join(" · ");
  const isManual = job.manual_link || job.source === "Manual";
  const manualBadge = isManual ? `<span class="badge badge--manual">Pasted</span>` : "";

  detailEl.innerHTML = `
    <div class="job-detail-card">
      <div class="job-detail-header">
        <div>
          <div class="job-detail-title">${escapeHtml(job.role)}</div>
          <div class="job-detail-company">${escapeHtml(job.company || "Company not listed")}</div>
          <div class="job-detail-meta">${escapeHtml(metaLine || "")}</div>
          <div class="job-detail-meta">Status: ${escapeHtml(statusLabel)}${dismissNote ? ` · ${escapeHtml(dismissNote)}` : ""}</div>
        </div>
        <div class="job-detail-badges">
          <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
          <div class="${getLocationBadgeClass(job.location)}" title="${escapeHtml(job.location)}">${escapeHtml(job.location || "Unknown")}</div>
          ${manualBadge}
          ${job.apply_method ? `<span class="badge badge--method">${escapeHtml(job.apply_method)}</span>` : ""}
          ${formatApplicantBadge(job.applicant_count)}
        </div>
      </div>
      <div class="job-detail-actions">
        <button class="btn btn-quick-apply${
          statusValue !== "saved" && statusValue !== "shortlisted" && statusValue !== "ready_to_apply" ? " btn-quick-apply--done" : ""
        }">${statusValue === "applied" || statusValue === "interview" || statusValue === "offer" ? "Re-copy & Open" : "Apply now"}</button>
        <button class="btn btn-secondary btn-shortlist"${statusValue === "shortlisted" ? " disabled" : ""}>${
          statusValue === "shortlisted" ? "Shortlisted" : "Shortlist"
        }</button>
        <button class="btn btn-secondary btn-dismiss">Dismiss</button>
        <button class="btn btn-prep" data-job-id="${escapeHtml(job.id)}">Prep</button>
        <a class="btn btn-tertiary" href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View link</a>
      </div>
      <div class="job-detail-tabs">
        <button class="detail-tab detail-tab--active" data-tab="summary">Summary</button>
        <button class="detail-tab" data-tab="fit">Fit</button>
        <button class="detail-tab" data-tab="cv">CV</button>
        <button class="detail-tab" data-tab="ats">ATS</button>
        <button class="detail-tab" data-tab="prep">Prep</button>
        <button class="detail-tab" data-tab="apply">Apply</button>
      </div>
      <div class="detail-tab-panel is-active" data-tab="summary">
        <div class="detail-box">
          <div class="section-title">Role summary</div>
          <div>${formatInlineText(job.role_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Key requirements</div>
          ${requirementsList}
        </div>
        <div class="detail-box">
          <div class="section-title">Company insights</div>
          <div>${formatInlineText(job.company_insights || "Not available yet.")}</div>
        </div>
      </div>
      <div class="detail-tab-panel" data-tab="fit">
        <div class="detail-box">
          <div class="section-title">Why you fit</div>
          <div>${formatInlineText(job.why_fit || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Potential gaps</div>
          <div>${formatInlineText(job.cv_gap || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Match notes</div>
          <div>${formatInlineText(job.match_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Hiring scorecard</div>
          ${scorecardList}
        </div>
      </div>
      <div class="detail-tab-panel" data-tab="cv">
        <div class="detail-box">
          <div class="section-title">Tailored CV${hasCvTailoredChanges(job) ? ' <span style="color:#059669;font-size:11px;font-weight:500;margin-left:6px;">Tailored</span>' : ""}</div>
          <div class="cv-tab-preview" id="cv-tab-render"></div>
          <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
            <button class="btn btn-primary cv-tab-download" data-job-id="${escapeHtml(job.id)}">Download PDF</button>
            <button class="btn btn-secondary cv-tab-copy" data-job-id="${escapeHtml(job.id)}">Copy as text</button>
            <button class="btn btn-tertiary cv-tab-modal" data-job-id="${escapeHtml(job.id)}">Open full preview</button>
          </div>
        </div>
      </div>
      <div class="detail-tab-panel" data-tab="ats">
        <div class="detail-box">
          <div class="section-title">Tailored summary</div>
          <div>${formatInlineText(job.tailored_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored CV bullets (ATS-ready)</div>
          ${bulletList}
          <button class="btn btn-tertiary copy-btn" data-copy-type="bullets" data-job-id="${escapeHtml(job.id)}">Copy bullets</button>
        </div>
        <div class="detail-box">
          <div class="section-title">ATS keyword coverage</div>
          ${buildAtsKeywordSection(job)}
        </div>
        <div class="detail-box">
          <div class="section-title">CV edits for this role</div>
          <div>${formatInlineText(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored CV</div>
          <div class="cv-preview">${
            job.tailored_cv_sections?.summary
              ? escapeHtml(job.tailored_cv_sections.summary).slice(0, 150) + "…"
              : "CV will be tailored with your profile. Download to preview."
          }</div>
          <button class="btn btn-primary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download PDF</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy as text</button>
        </div>
      </div>
      <div class="detail-tab-panel" data-tab="prep">
        <div class="detail-box">
          <div class="section-title">Quick pitch</div>
          <div>${formatInlineText(job.quick_pitch || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Key talking points</div>
          ${talkingPoints}
        </div>
        <div class="detail-box">
          <div class="section-title">STAR stories (10/10)</div>
          ${starStories}
        </div>
        <div class="detail-box">
          <div class="section-title">Interview Q&amp;A (8–10/10)</div>
          ${prepQaBlocks}
        </div>
      </div>
      <div class="detail-tab-panel" data-tab="apply">
        <div class="detail-box">
          <div class="section-title">How to apply</div>
          <div>${formatInlineText(job.apply_tips || "Apply with CV tailored to onboarding + KYC impact.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Cover letter</div>
          <div class="long-text">${formatInlineText(job.cover_letter || "Not available yet.")}</div>
          <button class="btn btn-tertiary copy-btn" data-copy-type="cover_letter" data-job-id="${escapeHtml(job.id)}">Copy cover letter</button>
        </div>
        <div class="detail-box tracking">
          <div class="section-title">Application tracking</div>
          <div class="tracking-grid">
            <label>Status</label>
            <select class="tracking-status">
              <option value="saved" ${statusValue === "saved" ? "selected" : ""}>New</option>
              <option value="applied" ${statusValue === "applied" ? "selected" : ""}>Applied</option>
              <option value="interview" ${statusValue === "interview" ? "selected" : ""}>Interview</option>
              <option value="offer" ${statusValue === "offer" ? "selected" : ""}>Offer</option>
              <option value="rejected" ${statusValue === "rejected" ? "selected" : ""}>Rejected</option>
              <option value="shortlisted" ${statusValue === "shortlisted" ? "selected" : ""}>Shortlisted</option>
              <option value="ready_to_apply" ${statusValue === "ready_to_apply" ? "selected" : ""}>Ready to Apply</option>
              <option value="dismissed" ${statusValue === "dismissed" ? "selected" : ""}>Dismissed</option>
            </select>
            <label>Applied date</label>
            <input type="date" class="tracking-applied" value="${appliedDate}" />
            <label>Last touch</label>
            <input type="date" class="tracking-last-touch" value="${lastTouchDate}" />
            <label>Next action</label>
            <input type="text" class="tracking-next-action" value="${escapeHtml(job.next_action || "")}" placeholder="e.g. Follow up email" />
            <label>Salary range</label>
            <input type="text" class="tracking-salary" value="${escapeHtml(job.salary_range || "")}" placeholder="e.g. 65-80k" />
            <label>Applied via</label>
            <select class="tracking-applied-via">
              <option value="" ${!job.applied_via ? "selected" : ""}>—</option>
              <option value="LinkedIn" ${job.applied_via === "LinkedIn" ? "selected" : ""}>LinkedIn</option>
              <option value="Company site" ${job.applied_via === "Company site" ? "selected" : ""}>Company site</option>
              <option value="Recruiter" ${job.applied_via === "Recruiter" ? "selected" : ""}>Recruiter</option>
              <option value="Referral" ${job.applied_via === "Referral" ? "selected" : ""}>Referral</option>
              <option value="Other" ${job.applied_via === "Other" ? "selected" : ""}>Other</option>
            </select>
            <label>Follow-up date</label>
            <input type="date" class="tracking-follow-up" value="${job.follow_up_date ? job.follow_up_date.slice(0, 10) : ""}" />
            <label>Interviewer</label>
            <input type="text" class="tracking-interviewer-name" value="${escapeHtml(job.interviewer_name || "")}" placeholder="Name" />
            <label>Interviewer email</label>
            <input type="email" class="tracking-interviewer-email" value="${escapeHtml(job.interviewer_email || "")}" placeholder="email@example.com" />
            <label>Interview date</label>
            <input type="date" class="tracking-interview-date" value="${job.interview_date ? job.interview_date.slice(0, 10) : ""}" />
            <label>Notes</label>
            <textarea class="tracking-notes" rows="3" placeholder="Notes...">${escapeHtml(job.application_notes || "")}</textarea>
          </div>
          <div class="tracking-validation-msg" style="color:#dc2626;font-size:12px;margin-bottom:6px;"></div>
          <button class="btn btn-primary save-tracking">Save update</button>
          <div class="tracking-status-msg"></div>
        </div>
      </div>
    </div>
  `;

  detailEl.querySelectorAll(".detail-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      detailEl.querySelectorAll(".detail-tab").forEach((btn) => btn.classList.remove("detail-tab--active"));
      detailEl.querySelectorAll(".detail-tab-panel").forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("detail-tab--active");
      const panel = detailEl.querySelector(`.detail-tab-panel[data-tab="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add("is-active");
      // Lazy-render CV preview when CV tab is first opened
      if (tab.dataset.tab === "cv") {
        const container = detailEl.querySelector("#cv-tab-render");
        if (container && !container.hasChildNodes()) {
          container.appendChild(buildTailoredCvHtml(job));
        }
      }
    });
  });

  const qaBtn = detailEl.querySelector(".btn-quick-apply");
  if (qaBtn) {
    qaBtn.addEventListener("click", () => quickApply(job));
  }

  const shortlistBtn = detailEl.querySelector(".btn-shortlist");
  if (shortlistBtn) {
    shortlistBtn.addEventListener("click", async () => {
      if (shortlistBtn.classList.contains("disabled")) return;
      if (!db) {
        showToast("Missing Firebase config.");
        return;
      }
      const now = new Date().toISOString();
      try {
        await updateDoc(doc(db, collectionName, job.id), {
          application_status: "shortlisted",
          updated_at: now,
        });
        job.application_status = "shortlisted";
        state.selectedJobs.delete(job.id);
        updateBulkBar();
        showToast("Moved to Shortlisted");
        renderJobs();
      } catch (err) {
        console.error(err);
        showToast("Shortlist failed.");
      }
    });
  }

  const dismissBtn = detailEl.querySelector(".btn-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", async () => {
      if (!db) {
        showToast("Missing Firebase config.");
        return;
      }
      const now = new Date().toISOString();
      try {
        await updateDoc(doc(db, collectionName, job.id), {
          application_status: "dismissed",
          dismiss_reason: "manual",
          updated_at: now,
        });
        job.application_status = "dismissed";
        job.dismiss_reason = "manual";
        state.selectedJobs.delete(job.id);
        updateBulkBar();
        showToast("Dismissed");
        renderJobs();
      } catch (err) {
        console.error(err);
        showToast("Dismiss failed.");
      }
    });
  }

  const prepBtn = detailEl.querySelector(".btn-prep");
  if (prepBtn) {
    prepBtn.addEventListener("click", () => openPrepMode(prepBtn.dataset.jobId));
  }

  detailEl.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const copyType = btn.dataset.copyType;
      const target = state.jobs.find((item) => item.id === jobId);
      if (!target) return;
      const text =
        copyType === "bullets"
          ? (target.tailored_cv_bullets || []).join("\n")
          : target.cover_letter || "";
      copyToClipboard(text);
    });
  });

  detailEl.querySelectorAll(".prep-qa__select").forEach((select) => {
    const answerEl = select.closest(".prep-qa")?.querySelector(".prep-qa__answer");
    select.addEventListener("change", () => {
      const selected = select.selectedOptions[0];
      if (!answerEl) return;
      const raw = selected?.dataset?.answer || "";
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch (error) {
        decoded = raw;
      }
      answerEl.innerHTML = formatInlineText(decoded || "Not available yet.");
    });
  });

  const downloadCvBtn = detailEl.querySelector(".download-cv-btn");
  if (downloadCvBtn) {
    downloadCvBtn.addEventListener("click", () => {
      const target = state.jobs.find((item) => item.id === downloadCvBtn.dataset.jobId);
      if (!target) return;
      openJobsCvModal(target);
    });
  }

  const copyCvTextBtn = detailEl.querySelector(".copy-cv-text-btn");
  if (copyCvTextBtn) {
    copyCvTextBtn.addEventListener("click", () => {
      const target = state.jobs.find((item) => item.id === copyCvTextBtn.dataset.jobId);
      if (!target) return;
      copyToClipboard(getTailoredCvPlainText(target));
    });
  }

  // CV tab buttons
  const cvTabDownload = detailEl.querySelector(".cv-tab-download");
  if (cvTabDownload) {
    cvTabDownload.addEventListener("click", async () => {
      const target = state.jobs.find((item) => item.id === cvTabDownload.dataset.jobId);
      if (!target) return;
      const htmlEl = buildTailoredCvHtml(target);
      const companySlug = (target.company || "Company").replace(/[^a-zA-Z0-9]/g, "");
      try {
        showToast("Generating PDF…");
        await renderPdfFromElement(htmlEl, {
          margin: [10, 15],
          filename: `AdeOmosanya_CV_${companySlug}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "a4" },
        });
        showToast("PDF ready");
      } catch (err) {
        console.error(err);
        showToast("PDF failed to generate.");
      }
    });
  }
  const cvTabCopy = detailEl.querySelector(".cv-tab-copy");
  if (cvTabCopy) {
    cvTabCopy.addEventListener("click", () => {
      const target = state.jobs.find((item) => item.id === cvTabCopy.dataset.jobId);
      if (!target) return;
      copyToClipboard(getTailoredCvPlainText(target));
    });
  }
  const cvTabModal = detailEl.querySelector(".cv-tab-modal");
  if (cvTabModal) {
    cvTabModal.addEventListener("click", () => {
      const target = state.jobs.find((item) => item.id === cvTabModal.dataset.jobId);
      if (!target) return;
      openJobsCvModal(target);
    });
  }

  const saveBtn = detailEl.querySelector(".save-tracking");
  const statusEl = detailEl.querySelector(".tracking-status");
  const appliedEl = detailEl.querySelector(".tracking-applied");
  const lastTouchEl = detailEl.querySelector(".tracking-last-touch");
  const nextActionEl = detailEl.querySelector(".tracking-next-action");
  const notesEl = detailEl.querySelector(".tracking-notes");
  const salaryEl = detailEl.querySelector(".tracking-salary");
  const appliedViaEl = detailEl.querySelector(".tracking-applied-via");
  const followUpEl = detailEl.querySelector(".tracking-follow-up");
  const interviewerNameEl = detailEl.querySelector(".tracking-interviewer-name");
  const interviewerEmailEl = detailEl.querySelector(".tracking-interviewer-email");
  const interviewDateEl = detailEl.querySelector(".tracking-interview-date");
  const statusMsg = detailEl.querySelector(".tracking-status-msg");
  const validationMsg = detailEl.querySelector(".tracking-validation-msg");

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!db) {
        statusMsg.textContent = "Missing Firebase config.";
        return;
      }

      if (validationMsg) validationMsg.textContent = "";
      if (statusEl.value === "interview" && interviewDateEl && !interviewDateEl.value) {
        if (validationMsg) validationMsg.textContent = "Please set an interview date.";
        interviewDateEl.focus();
        interviewDateEl.style.borderColor = "#dc2626";
        return;
      }
      if (interviewDateEl) interviewDateEl.style.borderColor = "";

      const todayStr = new Date().toISOString().slice(0, 10);
      if (statusEl.value === "applied" && !appliedEl.value) {
        appliedEl.value = todayStr;
      }
      lastTouchEl.value = todayStr;

      const toIsoDate = (val) => (val ? `${val}T00:00:00.000Z` : "");
      const payload = {
        application_status: statusEl.value,
        application_date: toIsoDate(appliedEl.value),
        last_touch_date: toIsoDate(lastTouchEl.value),
        next_action: nextActionEl.value,
        application_notes: notesEl.value,
        salary_range: salaryEl.value,
        applied_via: appliedViaEl.value,
        follow_up_date: toIsoDate(followUpEl.value),
        interviewer_name: interviewerNameEl.value,
        interviewer_email: interviewerEmailEl.value,
        interview_date: toIsoDate(interviewDateEl.value),
        updated_at: new Date().toISOString(),
      };
      try {
        await updateDoc(doc(db, collectionName, job.id), payload);
        Object.assign(job, payload);
        statusMsg.textContent = "Updated.";
      } catch (error) {
        console.error(error);
        statusMsg.textContent = "Save failed.";
      }
    });
  }
};

export const renderJobs = () => {
  const filtered = getFilteredJobs();

  if (mobileNavObserver) {
    mobileNavObserver.disconnect();
    mobileNavObserver = null;
  }

  const filteredIds = new Set(filtered.map((j) => j.id));
  for (const id of state.selectedJobs) {
    if (!filteredIds.has(id)) state.selectedJobs.delete(id);
  }
  updateBulkBar();

  const existingSelectAll = document.querySelector(".bulk-select-all-bar");
  if (existingSelectAll) existingSelectAll.remove();
  if (filtered.length > 0) {
    const selectAllBar = document.createElement("div");
    selectAllBar.className = "bulk-select-all-bar";
    selectAllBar.innerHTML = `<label class="toggle-label"><input type="checkbox" class="bulk-select-all" ${
      state.selectedJobs.size === filtered.length && filtered.length > 0 ? "checked" : ""
    } /> Select all (${filtered.length})</label>`;
    jobsContainer.parentNode.insertBefore(selectAllBar, jobsContainer);
    const selectAllCb = selectAllBar.querySelector(".bulk-select-all");
    selectAllCb.addEventListener("change", () => {
      if (selectAllCb.checked) {
        filtered.forEach((j) => state.selectedJobs.add(j.id));
      } else {
        state.selectedJobs.clear();
      }
      document.querySelectorAll(".bulk-check").forEach((cb) => {
        cb.checked = selectAllCb.checked;
      });
      updateBulkBar();
    });
  }

  const listEl = document.getElementById("job-list");
  const detailEl = document.getElementById("job-detail");
  if (!listEl || !detailEl) {
    jobsContainer.innerHTML = `<div class="detail-box">Layout error: job list panel missing.</div>`;
    return;
  }

  listEl.innerHTML = "";
  detailEl.innerHTML = "";

  if (!filtered.length) {
    detailEl.innerHTML = `<div class="job-detail-empty">No roles match these filters yet. Try lowering the fit threshold or clearing filters.</div>`;
    return;
  }

  if (!state.selectedJobId || !filteredIds.has(state.selectedJobId)) {
    state.selectedJobId = filtered[0].id;
  }

  filtered.forEach((job) => {
    const statusValue = (job.application_status || "saved").toLowerCase();
    const statusLabel = formatStatusLabel(statusValue);
    const postedDisplay = job.posted_raw || job.posted || job.posted_date || "";
    const applicantDisplay = job.applicant_count ? ` · ${job.applicant_count} applicants` : "";
    const openStatus =
      job.job_status ||
      (job.is_open === true ? "Open" : "") ||
      (job.is_open === false ? "Closed" : "") ||
      (job.is_closed ? "Closed" : "");
    const statusSuffix = openStatus ? ` · ${openStatus}` : "";
    const isManual = job.manual_link || job.source === "Manual";

    const item = document.createElement("div");
    item.className = `job-list-item${job.id === state.selectedJobId ? " is-active" : ""}`;
    item.innerHTML = `
      <label class="bulk-check-label"><input type="checkbox" class="bulk-check" data-job-id="${escapeHtml(job.id)}" ${
      state.selectedJobs.has(job.id) ? "checked" : ""
    } /></label>
      <div class="job-list-main">
        <div class="job-list-title">${escapeHtml(job.role)}</div>
        <div class="job-list-company">${escapeHtml(job.company || "Company not listed")}</div>
        <div class="job-list-meta">${escapeHtml(formatPosted(postedDisplay))} · ${escapeHtml(job.source)}${escapeHtml(applicantDisplay)}${escapeHtml(statusSuffix)}</div>
        <div class="job-list-meta">Status: ${escapeHtml(statusLabel)}</div>
      </div>
      <div class="job-list-badges">
        <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
        ${isManual ? `<span class="badge badge--manual">Pasted</span>` : ""}
      </div>
    `;

    const bulkCheck = item.querySelector(".bulk-check");
    if (bulkCheck) {
      bulkCheck.addEventListener("change", (event) => {
        event.stopPropagation();
        if (bulkCheck.checked) {
          state.selectedJobs.add(job.id);
        } else {
          state.selectedJobs.delete(job.id);
        }
        updateBulkBar();
      });
    }

    item.addEventListener("click", () => {
      state.selectedJobId = job.id;
      document.querySelectorAll(".job-list-item").forEach((el) => el.classList.remove("is-active"));
      item.classList.add("is-active");
      renderJobDetail(job, detailEl);
      detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    listEl.appendChild(item);
  });

  const selectedJob = filtered.find((j) => j.id === state.selectedJobId) || filtered[0];
  renderJobDetail(selectedJob, detailEl);
};

// Back to top floating button
if (!document.getElementById("back-to-top-btn")) {
  const btn = document.createElement("button");
  btn.id = "back-to-top-btn";
  btn.textContent = "\u2191 Top";
  btn.style.cssText =
    "position:fixed;bottom:24px;right:24px;z-index:900;display:none;padding:10px 16px;" +
    "border-radius:8px;border:1px solid #cbd5e1;background:#0f172a;color:#fff;font-size:13px;" +
    "font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:opacity 0.2s;";
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.appendChild(btn);
  window.addEventListener("scroll", () => {
    btn.style.display = window.scrollY > 400 ? "block" : "none";
  });
}

state.handlers.renderJobs = renderJobs;
state.handlers.getFilteredJobs = getFilteredJobs;
state.handlers.updateBulkBar = updateBulkBar;
