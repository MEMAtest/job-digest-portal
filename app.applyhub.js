import {
  state,
  getDb,
  collectionName,
  doc,
  updateDoc,
  parseDateValue,
  parseApplicantCount,
  escapeHtml,
  formatInlineText,
  formatFitBadge,
  formatList,
  copyToClipboard,
  showToast,
  showConfirmToast,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "./app.core.js";
import { getTailoredCvPlainText, buildTailoredCvHtml, renderPdfFromElement, hasCvTailoredChanges } from "./app.cv.js";
import {
  makeEditable,
  saveTailoredCvSection,
  saveBaseCvSection,
  saveCoverLetter,
  saveTailoredSummary,
  buildSideBySideDiff,
  buildApplicationPackHtml,
} from "./app.cvhub.js";

const loadHubSort = () => {
  try {
    const stored = safeLocalStorageGet("hub_sort");
    if (stored) return JSON.parse(stored);
  } catch (error) {
    // ignore
  }
  return { field: "fit_score", dir: "desc" };
};

const saveHubSort = (sort) => {
  try {
    safeLocalStorageSet("hub_sort", JSON.stringify(sort));
  } catch (error) {
    // ignore
  }
};

state.hubSort = loadHubSort();

// hasCvTailoredChanges is imported from app.cv.js and re-exported for backward compat
export { hasCvTailoredChanges };

export const resolveChecklistState = (job) => {
  const auto = {
    cv_tailored: hasCvTailoredChanges(job),
    cover_letter_reviewed: Boolean(job.cover_letter),
    requirements_matched: (job.fit_score || 0) >= 75 && Array.isArray(job.key_requirements) && job.key_requirements.length > 0,
    application_submitted: (job.application_status || "").toLowerCase() === "applied",
  };
  const existing = job.apply_checklist || {};
  // Only manual fields (job_link_visited) are persisted overrides;
  // auto-computed fields always reflect current data state.
  const merged = {
    ...auto,
    job_link_visited: existing.job_link_visited || false,
  };
  if ((job.application_status || "").toLowerCase() === "applied") {
    merged.application_submitted = true;
  }
  return merged;
};

export const saveApplyChecklist = async (job, updates, options = {}) => {
  if (!job) return;
  const next = { ...resolveChecklistState(job), ...updates };
  if (options.markApplied) {
    next.application_submitted = true;
  }
  job.apply_checklist = next;

  if (!getDb()) return;
  const payload = {
    apply_checklist: next,
    updated_at: new Date().toISOString(),
  };
  if (options.markApplied) {
    const today = new Date().toISOString().slice(0, 10);
    payload.application_status = "applied";
    payload.application_date = `${today}T00:00:00.000Z`;
    payload.last_touch_date = new Date().toISOString();
    job.application_status = "applied";
    job.application_date = payload.application_date;
    job.last_touch_date = payload.last_touch_date;
  }
  try {
    await updateDoc(doc(getDb(), collectionName, job.id), payload);
  } catch (error) {
    console.error("Checklist save failed:", error);
  }
};

const buildPreviewText = (html) => {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const text = (temp.textContent || "").trim();
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}\u2026` : text;
};

const buildCvDiff = (job) => {
  const tailored = job.tailored_cv_sections || {};
  const sectionDefs = [
    { key: "summary", label: "Professional Summary", isArray: false },
    { key: "key_achievements", label: "Key Achievements", isArray: true },
    { key: "vistra_bullets", label: "Vistra Experience", isArray: true },
    { key: "ebury_bullets", label: "Ebury Experience", isArray: true },
  ];

  let html = "";
  for (const sec of sectionDefs) {
    const tailoredVal = tailored[sec.key];
    const baseVal = state.baseCvSections[sec.key];
    const hasTailored =
      tailoredVal &&
      (sec.isArray
        ? Array.isArray(tailoredVal) && tailoredVal.length > 0
        : typeof tailoredVal === "string" && tailoredVal.trim() !== "");
    const isChanged = hasTailored && JSON.stringify(tailoredVal) !== JSON.stringify(baseVal);

    const cssClass = isChanged ? "cv-diff__section--changed" : "cv-diff__section--unchanged";
    const labelSuffix = isChanged ? "Tailored" : "Unchanged";

    let content;
    if (sec.isArray) {
      const items = hasTailored ? tailoredVal : baseVal;
      content = formatList(items);
    } else {
      content = formatInlineText(hasTailored ? tailoredVal : baseVal);
    }

    html += `
      <div class="cv-diff__section ${cssClass}">
        <div class="cv-diff__label">${sec.label} \u2014 ${labelSuffix}</div>
        <div class="cv-diff__content">${content}</div>
        ${isChanged ? `<button class="btn btn-tertiary cv-section-edit-btn" data-cv-key="${sec.key}" data-is-array="${sec.isArray}">Edit ${sec.label}</button>` : ""}
      </div>
    `;
  }

  if (job.cv_edit_notes) {
    html += `<div class="cv-diff__notes"><strong>Edit notes:</strong> ${formatInlineText(job.cv_edit_notes)}</div>`;
  }

  return html;
};

const sortHubJobs = (jobs) => {
  const sort = state.hubSort || { field: "fit_score", dir: "desc" };
  const sorted = [...jobs];
  const dir = sort.dir === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (sort.field === "company") {
      return dir * String(a.company || "").localeCompare(String(b.company || ""));
    }
    if (sort.field === "posted") {
      const da = parseDateValue(a.posted) || new Date(0);
      const db2 = parseDateValue(b.posted) || new Date(0);
      return dir * (da - db2);
    }
    if (sort.field === "applicant_count") {
      const ca = parseApplicantCount(a.applicant_count) ?? Number.POSITIVE_INFINITY;
      const cb = parseApplicantCount(b.applicant_count) ?? Number.POSITIVE_INFINITY;
      return dir * (ca - cb);
    }
    return dir * ((a.fit_score || 0) - (b.fit_score || 0));
  });

  return sorted;
};

const getUnifiedHubJobs = () => {
  const included = ["ready_to_apply", "applied", "interview", "offer"];
  const excluded = ["dismissed", "rejected"];
  return state.jobs.filter((j) => {
    const status = (j.application_status || "saved").toLowerCase();
    if (excluded.includes(status)) return false;
    if (included.includes(status)) return true;
    if (hasCvTailoredChanges(j)) return true;
    if (j.cover_letter) return true;
    return false;
  });
};

const filterHubJobs = (jobs) => {
  const f = state.hubFilter || "all";
  if (f === "ready_to_apply") return jobs.filter((j) => (j.application_status || "saved").toLowerCase() === "ready_to_apply");
  if (f === "applied") {
    const tracked = ["applied", "interview", "offer"];
    return jobs.filter((j) => tracked.includes((j.application_status || "saved").toLowerCase()));
  }
  if (f === "tailored") return jobs.filter((j) => hasCvTailoredChanges(j));
  if (f === "cover_letter") return jobs.filter((j) => j.cover_letter);
  return jobs;
};

export const quickApply = async (job, card) => {
  const status = (job.application_status || "saved").toLowerCase();
  const shouldMarkApplied = status === "saved" || status === "shortlisted" || status === "ready_to_apply";

  const cvText = getTailoredCvPlainText(job);
  const coverLetter = job.cover_letter || "";
  const clipboardPayload = `=== TAILORED CV ===\n${cvText}\n\n=== COVER LETTER ===\n${coverLetter}`;
  try {
    await navigator.clipboard.writeText(clipboardPayload);
  } catch (err) {
    console.error("Clipboard write failed:", err);
  }

  if (job.link && /^https?:\/\//.test(job.link)) {
    window.open(job.link, "_blank", "noopener");
  }

  await saveApplyChecklist(job, { job_link_visited: true });

  if (shouldMarkApplied) {
    if (getDb()) {
      showConfirmToast("CV copied & link opened", "Mark as Applied", async () => {
        await saveApplyChecklist(job, { job_link_visited: true }, { markApplied: true });
        const today = new Date().toISOString().slice(0, 10);
        const now = new Date().toISOString();

        if (card) {
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = "Status: applied";
          });
          const trackingSelect = card.querySelector(".tracking-status");
          if (trackingSelect) trackingSelect.value = "applied";
          const appliedInput = card.querySelector(".tracking-applied");
          if (appliedInput) appliedInput.value = today;
          const lastTouchInput = card.querySelector(".tracking-last-touch");
          if (lastTouchInput) lastTouchInput.value = now.slice(0, 10);
          const qaBtn = card.querySelector(".btn-quick-apply");
          if (qaBtn) {
            qaBtn.textContent = "Re-copy & Open";
            qaBtn.classList.add("btn-quick-apply--done");
          }
        }
        showToast("Marked as applied");
      });
    } else {
      showToast("Copied + opened link");
    }
  } else {
    showToast("Copied + opened link");
  }
};

let hubShowCount = 15;

export const renderApplyHub = () => {
  const hubContainer = document.getElementById("apply-hub");
  if (!hubContainer) return;

  const existingNotes = hubContainer.querySelectorAll?.(".hub-notes") || [];
  existingNotes.forEach((textarea) => {
    const jobId = textarea.dataset.jobId;
    if (!jobId) return;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.application_notes = textarea.value.slice(0, 500);
  });

  const allHubJobs = getUnifiedHubJobs();
  const filteredJobs = filterHubJobs(allHubJobs);
  const sortedJobs = sortHubJobs(filteredJobs);
  const displayJobs = sortedJobs.slice(0, hubShowCount);
  const hasMore = sortedJobs.length > hubShowCount;

  const readyCount = allHubJobs.filter((j) => (j.application_status || "saved").toLowerCase() === "ready_to_apply").length;
  const trackedStatuses = ["applied", "interview", "offer"];
  const appliedCount = allHubJobs.filter((j) => trackedStatuses.includes((j.application_status || "saved").toLowerCase())).length;
  const tailoredCount = allHubJobs.filter((j) => hasCvTailoredChanges(j)).length;
  const coverLetterCount = allHubJobs.filter((j) => j.cover_letter).length;

  const sortOptions = [
    { field: "fit_score", label: "Fit" },
    { field: "posted", label: "Date" },
    { field: "company", label: "Company" },
    { field: "applicant_count", label: "Applicants" },
  ];

  const currentSort = state.hubSort || { field: "fit_score", dir: "desc" };
  const currentFilter = state.hubFilter || "all";

  const filterPills = [
    { value: "all", label: `All (${allHubJobs.length})` },
    { value: "ready_to_apply", label: `Ready to Apply (${readyCount})` },
    { value: "applied", label: `Applied/Tracked (${appliedCount})` },
    { value: "tailored", label: `Tailored CVs (${tailoredCount})` },
    { value: "cover_letter", label: `Cover Letters (${coverLetterCount})` },
  ];

  const sectionDefs = [
    { key: "summary", label: "Summary", isArray: false },
    { key: "key_achievements", label: "Key Achievements", isArray: true },
    { key: "vistra_bullets", label: "Vistra Experience", isArray: true },
    { key: "ebury_bullets", label: "Ebury Experience", isArray: true },
  ];

  const base = state.baseCvSections;

  const renderHubCard = (job) => {
    const statusValue = (job.application_status || "saved").toLowerCase();
    const isApplied = trackedStatuses.includes(statusValue);
    const checklist = resolveChecklistState(job);
    const checklistItems = [
      { key: "cv_tailored", label: "CV tailored" },
      { key: "cover_letter_reviewed", label: "Cover letter reviewed" },
      { key: "requirements_matched", label: "Requirements matched" },
      { key: "job_link_visited", label: "Job link visited" },
      { key: "application_submitted", label: "Application submitted" },
    ];
    const checkReady = checklistItems.reduce((acc, item) => acc + (checklist[item.key] ? 1 : 0), 0);
    const checkTotal = checklistItems.length;
    const readyPct = Math.round((checkReady / checkTotal) * 100);
    const allReady = checkReady === checkTotal;

    const hasTailored = hasCvTailoredChanges(job);
    const hasCover = Boolean(job.cover_letter);

    const tailoredSections = job.tailored_cv_sections || {};
    const changedCount = sectionDefs.filter((sec) => {
      const tv = tailoredSections[sec.key];
      if (!tv) return false;
      return JSON.stringify(tv) !== JSON.stringify(base[sec.key]);
    }).length;

    const cvDiffHtml = buildCvDiff(job);
    const cvDiffPreview = buildPreviewText(cvDiffHtml);
    const summaryPreview = buildPreviewText(formatInlineText(job.tailored_summary || ""));
    const coverPreview = buildPreviewText(formatInlineText(job.cover_letter || ""));
    const requirementsPreview = buildPreviewText((job.key_requirements || []).map((req) => String(req)).join(" \u00b7 "));
    const noteText = job.application_notes || "";
    const noteCount = Math.min(noteText.length, 500);
    const actionLabel =
      isApplied
        ? "Re-copy & Open"
        : allReady
        ? "Ready \u2014 Apply now"
        : "Quick Apply";

    const tagsHtml = [
      hasTailored ? `<span class="cv-pack-tag cv-pack-tag--changed">${changedCount} section${changedCount !== 1 ? "s" : ""} tailored</span>` : "",
      hasCover ? '<span class="cv-pack-tag cv-pack-tag--changed">Cover letter</span>' : "",
    ].filter(Boolean).join("");

    return `
      <div class="hub-card${isApplied ? " hub-card--applied" : ""}" data-job-id="${escapeHtml(job.id)}">
        <div class="hub-card__header">
          <div>
            <h3>${escapeHtml(job.role)}</h3>
            <p>${escapeHtml(job.company)} \u00b7 ${escapeHtml(job.location)}</p>
            ${tagsHtml ? `<div class="hub-card__tags">${tagsHtml}</div>` : ""}
          </div>
          <span class="${formatFitBadge(job.fit_score)}">${job.fit_score}%</span>
        </div>

        <div class="hub-card__progress">
          <div class="hub-progress__bar"><span style="width:${readyPct}%;"></span></div>
          <div class="hub-progress__label">${checkReady}/${checkTotal} ready</div>
        </div>

        <details class="hub-card__section" data-section="requirements">
          <summary>
            <h4>Key Requirements</h4>
            <span class="hub-card__preview">${escapeHtml(requirementsPreview || "No requirements yet.")}</span>
          </summary>
          <div class="hub-card__content">
            ${formatList(job.key_requirements || [])}
          </div>
        </details>

        <details class="hub-card__section" data-section="cv_diff">
          <summary>
            <h4>CV Differences</h4>
            <span class="hub-card__preview">${escapeHtml(cvDiffPreview || "CV diff ready once tailored.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="cv-diff" data-job-id="${escapeHtml(job.id)}">${cvDiffHtml}</div>
          </div>
        </details>

        <details class="hub-card__section" data-section="summary">
          <summary>
            <h4>Tailored Summary</h4>
            <span class="hub-card__preview">${escapeHtml(summaryPreview || "Summary will appear after enrichment.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="hub-editable-summary" data-job-id="${escapeHtml(job.id)}">${formatInlineText(job.tailored_summary || "")}</div>
            ${job.tailored_summary ? `<button class="btn btn-tertiary hub-edit-summary-btn" data-job-id="${escapeHtml(job.id)}">Edit</button>` : ""}
          </div>
        </details>

        <details class="hub-card__section" data-section="cover_letter">
          <summary>
            <h4>Cover Letter</h4>
            <span class="hub-card__preview">${escapeHtml(coverPreview || "Cover letter not generated yet.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="hub-editable-cover long-text" data-job-id="${escapeHtml(job.id)}">${formatInlineText(job.cover_letter || "")}</div>
            ${hasCover ? `<button class="btn btn-tertiary hub-edit-cover-btn" data-job-id="${escapeHtml(job.id)}">Edit</button>` : ""}
          </div>
        </details>

        <details class="hub-card__section" data-section="checklist">
          <summary>
            <h4>Apply Checklist</h4>
            <span class="hub-card__preview">${checkReady}/${checkTotal} complete</span>
          </summary>
          <div class="hub-card__content">
            <div class="hub-checklist__items">
              ${checklistItems
                .map(
                  (item) => `
                <label class="checklist-item">
                  <input type="checkbox" data-check="${item.key}" ${checklist[item.key] ? "checked" : ""} />
                  <span>${item.label}</span>
                  ${
                    checklist[item.key]
                      ? '<span class="checklist-tag checklist-tag--done">Done</span>'
                      : '<span class="checklist-tag checklist-tag--warn">Review needed</span>'
                  }
                </label>`
                )
                .join("")}
            </div>
          </div>
        </details>

        <div class="hub-card__actions">
          <button class="btn btn-primary btn-quick-apply ${allReady ? "btn-quick-apply--ready" : ""}" data-job-id="${escapeHtml(job.id)}">${actionLabel}</button>
          <button class="btn btn-secondary hub-download-full-btn" data-job-id="${escapeHtml(job.id)}">Download Full Pack</button>
          <button class="btn btn-secondary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download CV PDF</button>
          <button class="btn btn-tertiary hub-preview-btn" data-job-id="${escapeHtml(job.id)}">Preview</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy CV Text</button>
          <button class="btn btn-tertiary hub-compare-btn" data-job-id="${escapeHtml(job.id)}">Compare vs Base</button>
        </div>

        <div class="hub-compare-container" data-job-id="${escapeHtml(job.id)}"></div>

        <div class="hub-card__notes">
          <label for="notes-${escapeHtml(job.id)}">Application notes</label>
          <textarea id="notes-${escapeHtml(job.id)}" class="hub-notes" data-job-id="${escapeHtml(job.id)}" maxlength="500" placeholder="Add notes \u2014 recruiter name, referral, conversation context...">${escapeHtml(noteText)}</textarea>
          <div class="hub-notes__meta">
            <span class="hub-notes__count">${noteCount}/500</span>
            <span class="hub-notes__saved hidden">Updated</span>
          </div>
        </div>
      </div>
    `;
  };

  let html = "";

  // Base CV card at top
  html += `
    <div class="cv-base-card">
      <div class="cv-base-card__header">
        <div>
          <h3>Base CV</h3>
          <p>Your master CV. Sections below (Summary, Achievements, Vistra, Ebury) are tailored per job. Everything else stays fixed.</p>
        </div>
        <div class="cv-base-card__actions">
          <button class="btn btn-secondary cv-base-download">Download Base CV</button>
          <button class="btn btn-secondary cv-base-preview">Preview CV</button>
          <button class="btn btn-tertiary cv-base-copy">Copy Base CV Text</button>
        </div>
      </div>
      <div class="cv-base-sections">
        ${sectionDefs
          .map((sec) => {
            const content = sec.isArray ? formatList(base[sec.key]) : formatInlineText(String(base[sec.key] || ""));
            return `
              <details class="cv-base-section hub-card__section">
                <summary class="cv-base-section__header">
                  <h4>${sec.label}</h4>
                  <button class="btn btn-tertiary cv-base-edit-btn" data-cv-key="${sec.key}">Edit</button>
                </summary>
                <div class="hub-card__content cv-base-content" data-cv-key="${sec.key}">${content}</div>
              </details>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  // Controls: filter pills + sort pills + expand toggle
  html += `
    <div class="hub-controls">
      <div class="hub-filter-pills">
        ${filterPills
          .map(
            (pill) =>
              `<button class="hub-filter__pill ${currentFilter === pill.value ? "active" : ""}" data-filter="${pill.value}">${pill.label}</button>`
          )
          .join("")}
      </div>
      <div class="hub-sort">
        ${sortOptions
          .map((opt) => {
            const active = currentSort.field === opt.field;
            const arrow = active ? (currentSort.dir === "asc" ? "\u2191" : "\u2193") : "";
            return `<button class="hub-sort__pill ${active ? "active" : ""}" data-sort="${opt.field}">${opt.label} ${arrow}</button>`;
          })
          .join("")}
      </div>
      <button class="btn btn-secondary hub-toggle" data-toggle="expand">Expand all</button>
    </div>
  `;

  if (!displayJobs.length) {
    html += `
      <div class="hub-empty">
        <h3>No jobs in this view</h3>
        <p>Use triage mode to mark jobs as "Apply" \u2014 they'll appear here with tailored CV diffs and quick actions.</p>
      </div>
    `;
  } else {
    html += displayJobs.map((j) => renderHubCard(j)).join("");
  }

  if (hasMore) {
    html += `<button class="btn btn-secondary hub-show-more" style="width:100%;margin-top:16px;">Show more (${sortedJobs.length - hubShowCount} remaining)</button>`;
  }

  // Preview modal
  html += `<div class="cv-preview-modal">
    <div class="cv-preview-modal__backdrop"></div>
    <div class="cv-preview-modal__content">
      <div class="cv-preview-modal__header">
        <h3>CV Preview</h3>
        <div class="cv-preview-modal__actions">
          <button class="btn btn-primary cv-preview-modal__download">Download PDF</button>
          <button class="cv-preview-modal__close">&times;</button>
        </div>
      </div>
      <div class="cv-preview-modal__body"></div>
    </div>
  </div>`;

  hubContainer.innerHTML = html;

  // --- Event wiring ---

  // Preview modal helpers
  let previewJob = null;
  const openPreviewModal = (jobOrEmpty) => {
    previewJob = jobOrEmpty;
    const modal = hubContainer.querySelector(".cv-preview-modal");
    if (!modal) return;
    const body = modal.querySelector(".cv-preview-modal__body");
    body.innerHTML = "";
    const cvEl = buildTailoredCvHtml(jobOrEmpty);
    body.appendChild(cvEl);
    modal.classList.add("cv-preview-modal--visible");
  };

  const closePreviewModal = () => {
    previewJob = null;
    const modal = hubContainer.querySelector(".cv-preview-modal");
    if (!modal) return;
    modal.classList.remove("cv-preview-modal--visible");
  };

  const modal = hubContainer.querySelector(".cv-preview-modal");
  if (modal) {
    modal.querySelector(".cv-preview-modal__backdrop")?.addEventListener("click", closePreviewModal);
    modal.querySelector(".cv-preview-modal__close")?.addEventListener("click", closePreviewModal);
    const downloadBtn = modal.querySelector(".cv-preview-modal__download");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", async () => {
        if (!previewJob) return;
        const cvEl = buildTailoredCvHtml(previewJob);
        const company = previewJob.company || "Base";
        const role = previewJob.role || "CV";
        const filename = `CV_${company}_${role}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const opt = { margin: [10, 10, 10, 10], filename, html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
        try {
          await renderPdfFromElement(cvEl, opt);
          showToast("CV downloaded");
        } catch (err) {
          console.error(err);
          showToast("Download failed");
        }
      });
    }
  }

  // Base CV buttons
  const baseDownloadBtn = hubContainer.querySelector(".cv-base-download");
  if (baseDownloadBtn) {
    baseDownloadBtn.addEventListener("click", async () => {
      const cvEl = buildTailoredCvHtml({ tailored_cv_sections: {} });
      const opt = { margin: [10, 10, 10, 10], filename: "CV_Base.pdf", html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
      try {
        await renderPdfFromElement(cvEl, opt);
        showToast("Base CV downloaded");
      } catch (err) {
        console.error(err);
        showToast("Download failed");
      }
    });
  }

  const basePreviewBtn = hubContainer.querySelector(".cv-base-preview");
  if (basePreviewBtn) {
    basePreviewBtn.addEventListener("click", () => openPreviewModal({ tailored_cv_sections: {} }));
  }

  const baseCopyBtn = hubContainer.querySelector(".cv-base-copy");
  if (baseCopyBtn) {
    baseCopyBtn.addEventListener("click", () => {
      copyToClipboard(getTailoredCvPlainText({ tailored_cv_sections: {} }));
    });
  }

  // Base CV edit buttons
  hubContainer.querySelectorAll(".cv-base-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const key = btn.dataset.cvKey;
      const contentEl = hubContainer.querySelector(`.cv-base-content[data-cv-key="${key}"]`);
      if (!contentEl) return;
      const isArray = Array.isArray(state.baseCvSections[key]);
      makeEditable(contentEl, {
        currentValue: state.baseCvSections[key],
        isArray,
        onSave: async (val) => {
          await saveBaseCvSection(key, val);
          renderApplyHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  // Base CV section toggles
  hubContainer.querySelectorAll(".cv-base-section").forEach((detailEl) => {
    const content = detailEl.querySelector(".hub-card__content");
    if (content) {
      content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    }
    detailEl.addEventListener("toggle", () => {
      if (content) content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    });
  });

  // Filter pills
  hubContainer.querySelectorAll(".hub-filter__pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.hubFilter = btn.dataset.filter;
      hubShowCount = 15;
      renderApplyHub();
    });
  });

  // Sort pills
  hubContainer.querySelectorAll(".hub-sort__pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.sort;
      if (!field) return;
      if (state.hubSort.field === field) {
        state.hubSort.dir = state.hubSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.hubSort.field = field;
        state.hubSort.dir = field === "company" ? "asc" : "desc";
      }
      saveHubSort(state.hubSort);
      hubShowCount = 15;
      renderApplyHub();
    });
  });

  // Show more
  const showMoreBtn = hubContainer.querySelector(".hub-show-more");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      hubShowCount += 10;
      renderApplyHub();
    });
  }

  // Expand/collapse toggle
  const hubToggleBtn = hubContainer.querySelector(".hub-toggle");
  if (hubToggleBtn) {
    hubToggleBtn.addEventListener("click", () => {
      const details = hubContainer.querySelectorAll(".hub-card .hub-card__section");
      const shouldOpen = hubToggleBtn.dataset.toggle !== "collapse";
      details.forEach((detailEl) => {
        detailEl.open = shouldOpen;
        const content = detailEl.querySelector(".hub-card__content");
        if (content) {
          content.style.maxHeight = shouldOpen ? `${content.scrollHeight}px` : "0px";
        }
        const jobId = detailEl.closest(".hub-card")?.dataset?.jobId;
        if (detailEl.dataset.section && jobId) {
          sessionStorage.setItem(`hub_section_${jobId}_${detailEl.dataset.section}`, shouldOpen ? "open" : "closed");
        }
      });
      hubToggleBtn.dataset.toggle = shouldOpen ? "collapse" : "expand";
      hubToggleBtn.textContent = shouldOpen ? "Collapse all" : "Expand all";
    });
  }

  // Job card section toggles (restore state)
  hubContainer.querySelectorAll(".hub-card .hub-card__section").forEach((detailEl) => {
    const jobId = detailEl.closest(".hub-card")?.dataset?.jobId;
    const sectionKey = detailEl.dataset.section;
    if (jobId && sectionKey) {
      const stored = sessionStorage.getItem(`hub_section_${jobId}_${sectionKey}`);
      if (stored === "open") detailEl.open = true;
      if (stored === "closed") detailEl.open = false;
    }
    const content = detailEl.querySelector(".hub-card__content");
    if (content) {
      content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    }
    detailEl.addEventListener("toggle", () => {
      if (content) {
        content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
      }
      if (jobId && sectionKey) {
        sessionStorage.setItem(`hub_section_${jobId}_${sectionKey}`, detailEl.open ? "open" : "closed");
      }
    });
  });

  if (hubToggleBtn) {
    const sections = Array.from(hubContainer.querySelectorAll(".hub-card .hub-card__section"));
    const openCount = sections.filter((d) => d.open).length;
    const allOpen = sections.length > 0 && openCount === sections.length;
    hubToggleBtn.dataset.toggle = allOpen ? "collapse" : "expand";
    hubToggleBtn.textContent = allOpen ? "Collapse all" : "Expand all";
  }

  // Quick Apply
  hubContainer.querySelectorAll(".btn-quick-apply").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (job) btn.addEventListener("click", () => quickApply(job, btn.closest(".hub-card")));
  });

  // Download Full Pack
  hubContainer.querySelectorAll(".hub-download-full-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.jobId);
      if (!job) return;
      const packEl = buildApplicationPackHtml(job);
      const filename = `ApplicationPack_${job.company}_${job.role}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const opt = { margin: [10, 10, 10, 10], filename, html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
      try {
        await renderPdfFromElement(packEl, opt);
        showToast("Application pack downloaded");
      } catch (err) {
        console.error(err);
        showToast("Download failed");
      }
    });
  });

  // Download CV PDF
  hubContainer.querySelectorAll(".download-cv-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", async () => {
      const cvEl = buildTailoredCvHtml(job);
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `CV_${job.company}_${job.role}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4" },
      };
      try {
        await renderPdfFromElement(cvEl, opt);
        showToast("CV downloaded");
      } catch (err) {
        console.error(err);
        showToast("Download failed");
      }
    });
  });

  // Preview
  hubContainer.querySelectorAll(".hub-preview-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.jobId);
      if (job) openPreviewModal(job);
    });
  });

  // Copy CV Text
  hubContainer.querySelectorAll(".copy-cv-text-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", () => {
      copyToClipboard(getTailoredCvPlainText(job));
      showToast("CV text copied");
    });
  });

  // Compare vs Base
  hubContainer.querySelectorAll(".hub-compare-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const container = hubContainer.querySelector(`.hub-compare-container[data-job-id="${jobId}"]`);
      if (!container) return;
      if (container.innerHTML.trim()) {
        container.innerHTML = "";
        btn.textContent = "Compare vs Base";
      } else {
        container.innerHTML = buildSideBySideDiff(job);
        btn.textContent = "Hide Compare";
      }
    });
  });

  // Edit CV section buttons (inside diff)
  hubContainer.querySelectorAll(".cv-section-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.closest(".hub-card")?.dataset?.jobId;
      const key = btn.dataset.cvKey;
      const isArray = btn.dataset.isArray === "true";
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const tailored = job.tailored_cv_sections || {};
      const sectionEl = btn.closest(".cv-diff__section");
      const contentEl = sectionEl?.querySelector(".cv-diff__content");
      if (!contentEl) return;
      makeEditable(contentEl, {
        currentValue: tailored[key] || state.baseCvSections[key],
        isArray,
        onSave: async (val) => {
          await saveTailoredCvSection(job, key, val);
          renderApplyHub();
        },
      });
    });
  });

  // Edit summary buttons
  hubContainer.querySelectorAll(".hub-edit-summary-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const contentEl = btn.closest(".hub-card__content");
      if (!contentEl) return;
      makeEditable(contentEl, {
        currentValue: job.tailored_summary || "",
        isArray: false,
        onSave: async (val) => {
          await saveTailoredSummary(job, val);
          renderApplyHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  // Edit cover letter buttons
  hubContainer.querySelectorAll(".hub-edit-cover-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const contentEl = btn.closest(".hub-card__content");
      if (!contentEl) return;
      makeEditable(contentEl, {
        currentValue: job.cover_letter || "",
        isArray: false,
        onSave: async (val) => {
          await saveCoverLetter(job, val);
          renderApplyHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  // Checklist checkboxes
  hubContainer.querySelectorAll(".checklist-item input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const jobId = checkbox.closest(".hub-card")?.dataset?.jobId;
      if (!jobId) return;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const key = checkbox.dataset.check;
      const updates = { [key]: checkbox.checked };
      const markApplied = key === "application_submitted" && checkbox.checked;
      await saveApplyChecklist(job, updates, { markApplied });
      renderApplyHub();
    });
  });

  // Notes autosave
  const notesTimers = state.hubNotesTimers || {};
  state.hubNotesTimers = notesTimers;
  hubContainer.querySelectorAll(".hub-notes").forEach((textarea) => {
    const jobId = textarea.dataset.jobId;
    const counter = textarea.parentElement?.querySelector(".hub-notes__count");
    const saved = textarea.parentElement?.querySelector(".hub-notes__saved");
    const updateCounter = () => {
      const len = Math.min(textarea.value.length, 500);
      if (counter) counter.textContent = `${len}/500`;
    };
    const scheduleSave = (immediate = false) => {
      if (!jobId) return;
      if (notesTimers[jobId]) clearTimeout(notesTimers[jobId]);
      const delay = immediate ? 0 : 500;
      notesTimers[jobId] = setTimeout(async () => {
        const job = state.jobs.find((j) => j.id === jobId);
        if (!job) return;
        job.application_notes = textarea.value.slice(0, 500);
        if (!getDb()) return;
        try {
          await updateDoc(doc(getDb(), collectionName, jobId), {
            application_notes: textarea.value.slice(0, 500),
            updated_at: new Date().toISOString(),
          });
          if (saved) {
            saved.classList.remove("hidden");
            setTimeout(() => saved.classList.add("hidden"), 1000);
          }
        } catch (error) {
          console.error("Notes save failed:", error);
        }
      }, delay);
    };
    textarea.addEventListener("input", () => {
      updateCounter();
      scheduleSave(false);
    });
    textarea.addEventListener("blur", () => scheduleSave(true));
    updateCounter();
  });
};

state.handlers.renderApplyHub = renderApplyHub;
state.handlers.renderCvHub = renderApplyHub;
