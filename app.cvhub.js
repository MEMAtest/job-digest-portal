import {
  state,
  getDb,
  collectionName,
  doc,
  updateDoc,
  setDoc,
  formatInlineText,
  formatList,
  escapeHtml,
  showToast,
  copyToClipboard,
  parseDateValue,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "./app.core.js";
import { getTailoredCvPlainText, buildTailoredCvHtml, renderPdfFromElement, hasCvTailoredChanges } from "./app.cv.js";

const loadCvHubSort = () => {
  try {
    const stored = safeLocalStorageGet("cv_hub_sort");
    if (stored) return JSON.parse(stored);
  } catch (_) {}
  return { field: "fit_score", dir: "desc" };
};

const saveCvHubSort = (sort) => {
  safeLocalStorageSet("cv_hub_sort", JSON.stringify(sort));
};

state.cvHubSort = loadCvHubSort();

export const makeEditable = (containerEl, { currentValue, isArray, onSave }) => {
  const original = containerEl.innerHTML;
  let textValue;
  if (isArray && Array.isArray(currentValue)) {
    textValue = currentValue.map((item) => String(item).replace(/^[-\s]*/, "")).join("\n");
  } else {
    textValue = String(currentValue || "");
  }

  containerEl.innerHTML = `
    <textarea class="cv-edit-textarea">${escapeHtml(textValue)}</textarea>
    <div class="cv-edit-actions">
      <button class="btn btn-primary cv-edit-save">Save</button>
      <button class="btn btn-secondary cv-edit-cancel">Cancel</button>
    </div>
  `;

  const textarea = containerEl.querySelector(".cv-edit-textarea");
  textarea.focus();
  textarea.style.height = `${Math.max(textarea.scrollHeight, 80)}px`;
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  });

  containerEl.querySelector(".cv-edit-save").addEventListener("click", () => {
    let parsed;
    if (isArray) {
      parsed = textarea.value
        .split("\n")
        .map((line) => line.replace(/^[-\s]*/, "").trim())
        .filter(Boolean);
    } else {
      parsed = textarea.value.trim();
    }
    onSave(parsed);
  });

  containerEl.querySelector(".cv-edit-cancel").addEventListener("click", () => {
    containerEl.innerHTML = original;
  });
};

export const saveTailoredCvSection = async (job, key, value) => {
  const existing = job.tailored_cv_sections || {};
  job.tailored_cv_sections = { ...existing, [key]: value };
  if (getDb()) {
    try {
      await updateDoc(doc(getDb(), collectionName, job.id), {
        tailored_cv_sections: job.tailored_cv_sections,
        updated_at: new Date().toISOString(),
      });
      showToast("CV section updated");
    } catch (err) {
      console.error("Save tailored CV section failed:", err);
      showToast("Save failed");
    }
  }
};

export const saveBaseCvSection = async (key, value) => {
  state.baseCvSections[key] = value;
  if (getDb()) {
    try {
      await setDoc(
        doc(getDb(), "cv_settings", "base_cv"),
        {
          ...state.baseCvSections,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
      showToast("Base CV updated");
    } catch (err) {
      console.error("Save base CV section failed:", err);
      showToast("Save failed");
    }
  }
};

export const saveCoverLetter = async (job, value) => {
  job.cover_letter = value;
  if (getDb()) {
    try {
      await updateDoc(doc(getDb(), collectionName, job.id), {
        cover_letter: value,
        updated_at: new Date().toISOString(),
      });
      showToast("Cover letter updated");
    } catch (err) {
      console.error("Save cover letter failed:", err);
      showToast("Save failed");
    }
  }
};

export const saveTailoredSummary = async (job, value) => {
  job.tailored_summary = value;
  if (getDb()) {
    try {
      await updateDoc(doc(getDb(), collectionName, job.id), {
        tailored_summary: value,
        updated_at: new Date().toISOString(),
      });
      showToast("Summary updated");
    } catch (err) {
      console.error("Save tailored summary failed:", err);
      showToast("Save failed");
    }
  }
};

export const buildApplicationPackHtml = (job) => {
  const container = document.createElement("div");

  const cvPage = buildTailoredCvHtml(job);
  container.appendChild(cvPage);

  if (job.cover_letter) {
    const clPage = document.createElement("div");
    clPage.style.cssText =
      "page-break-before:always;font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:10pt;line-height:1.6;";
    clPage.innerHTML = `
      <div style="font-size:14pt;font-weight:700;margin-bottom:16px;color:#0f172a;">Cover Letter</div>
      <div style="white-space:pre-wrap;">${escapeHtml(job.cover_letter)}</div>
    `;
    container.appendChild(clPage);
  }

  const hasReqs = job.key_requirements && job.key_requirements.length > 0;
  const hasSummary = job.tailored_summary;
  if (hasReqs || hasSummary) {
    const extPage = document.createElement("div");
    extPage.style.cssText =
      "page-break-before:always;font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:10pt;line-height:1.6;";
    let extHtml = "";
    if (hasReqs) {
      extHtml += `<div style="font-size:14pt;font-weight:700;margin-bottom:12px;color:#0f172a;">Key Requirements Match</div>`;
      extHtml += `<ul style="padding-left:20px;margin-bottom:24px;">${job.key_requirements
        .map((r) => `<li style="margin-bottom:4px;">${escapeHtml(String(r))}</li>`)
        .join("")}</ul>`;
    }
    if (hasSummary) {
      extHtml += `<div style="font-size:14pt;font-weight:700;margin-bottom:12px;color:#0f172a;">Tailored Summary</div>`;
      extHtml += `<div style="white-space:pre-wrap;">${escapeHtml(job.tailored_summary)}</div>`;
    }
    extPage.innerHTML = extHtml;
    container.appendChild(extPage);
  }

  return container;
};

export const buildSideBySideDiff = (job) => {
  const tailored = job.tailored_cv_sections || {};
  const sections = [
    { key: "summary", label: "Professional Summary", isArray: false },
    { key: "key_achievements", label: "Key Achievements", isArray: true },
    { key: "vistra_bullets", label: "Vistra Experience", isArray: true },
    { key: "ebury_bullets", label: "Ebury Experience", isArray: true },
  ];

  let html = '<div class="cv-compare-grid">';
  html += '<div class="cv-compare-grid__col"><div class="cv-compare-grid__heading">Base CV</div>';
  for (const sec of sections) {
    const baseVal = state.baseCvSections[sec.key];
    const tailoredVal = tailored[sec.key];
    const isChanged = tailoredVal && JSON.stringify(tailoredVal) !== JSON.stringify(baseVal);
    const cls = isChanged ? "cv-compare-grid__section--changed" : "cv-compare-grid__section--same";
    const content = sec.isArray ? formatList(baseVal) : formatInlineText(String(baseVal || ""));
    html += `<div class="cv-compare-grid__section ${cls}"><div class="cv-compare-grid__label">${sec.label}</div><div class="cv-compare-grid__content">${content}</div></div>`;
  }
  html += "</div>";

  html += '<div class="cv-compare-grid__col"><div class="cv-compare-grid__heading">Tailored CV</div>';
  for (const sec of sections) {
    const baseVal = state.baseCvSections[sec.key];
    const tailoredVal = tailored[sec.key];
    const hasTailored =
      tailoredVal &&
      (sec.isArray
        ? Array.isArray(tailoredVal) && tailoredVal.length > 0
        : typeof tailoredVal === "string" && tailoredVal.trim() !== "");
    const isChanged = hasTailored && JSON.stringify(tailoredVal) !== JSON.stringify(baseVal);
    const cls = isChanged ? "cv-compare-grid__section--changed" : "cv-compare-grid__section--same";
    const displayVal = hasTailored ? tailoredVal : baseVal;
    const content = sec.isArray ? formatList(displayVal) : formatInlineText(String(displayVal || ""));
    html += `<div class="cv-compare-grid__section ${cls}"><div class="cv-compare-grid__label">${sec.label}${
      isChanged ? " — Tailored" : ""
    }</div><div class="cv-compare-grid__content">${content}</div></div>`;
  }
  html += "</div></div>";

  return html;
};

const getCvHubJobs = () => {
  return state.jobs.filter((j) => hasCvTailoredChanges(j) || j.cover_letter);
};

const sortCvHubJobs = (jobs) => {
  const sort = state.cvHubSort;
  const dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...jobs];
  sorted.sort((a, b) => {
    if (sort.field === "company") return dir * String(a.company || "").localeCompare(String(b.company || ""));
    if (sort.field === "posted") {
      const da = parseDateValue(a.posted) || new Date(0);
      const db2 = parseDateValue(b.posted) || new Date(0);
      return dir * (da - db2);
    }
    return dir * ((a.fit_score || 0) - (b.fit_score || 0));
  });
  return sorted;
};

const filterCvHubJobs = (jobs) => {
  if (state.cvHubFilter === "tailored") return jobs.filter((j) => hasCvTailoredChanges(j));
  if (state.cvHubFilter === "cover_letter") return jobs.filter((j) => j.cover_letter);
  return jobs;
};

let cvHubShowCount = 10;

export const renderCvHub = () => {
  const hub = document.getElementById("cv-hub");
  if (!hub) return;

  const allCvJobs = getCvHubJobs();
  const tailoredCount = state.jobs.filter((j) => hasCvTailoredChanges(j)).length;
  const coverLetterCount = state.jobs.filter((j) => j.cover_letter).length;

  const filteredJobs = filterCvHubJobs(allCvJobs);
  const sortedJobs = sortCvHubJobs(filteredJobs);
  const displayJobs = sortedJobs.slice(0, cvHubShowCount);
  const hasMore = sortedJobs.length > cvHubShowCount;

  const base = state.baseCvSections;
  const sectionDefs = [
    { key: "summary", label: "Summary", isArray: false },
    { key: "key_achievements", label: "Key Achievements", isArray: true },
    { key: "vistra_bullets", label: "Vistra Experience", isArray: true },
    { key: "ebury_bullets", label: "Ebury Experience", isArray: true },
  ];

  const currentSort = state.cvHubSort;
  const filterPills = [
    { value: "all", label: "All" },
    { value: "tailored", label: `Tailored (${tailoredCount})` },
    { value: "cover_letter", label: `Cover letters (${coverLetterCount})` },
  ];

  const sortPills = [
    { value: "fit_score", label: "Fit" },
    { value: "posted", label: "Date" },
    { value: "company", label: "Company" },
  ];

  let html = `
    <div class="cv-hub-header">
      <div class="cv-hub-header__left">
        <h2>CV Hub</h2>
        <p>Save tailored CV sections and download application packs.</p>
      </div>
      <div class="cv-hub-header__right">
        <button class="btn btn-secondary cv-base-download">Download base CV</button>
        <button class="btn btn-secondary cv-base-preview">Preview CV</button>
        <button class="btn btn-tertiary cv-base-copy">Copy base CV text</button>
      </div>
    </div>
    <div class="cv-hub-pills">
      ${filterPills
        .map(
          (pill) =>
            `<button class="cv-hub-filter-pill ${state.cvHubFilter === pill.value ? "active" : ""}" data-filter="${pill.value}">${pill.label}</button>`
        )
        .join("")}
      <span class="cv-hub-divider"></span>
      ${sortPills
        .map((pill) => {
          const active = currentSort.field === pill.value;
          const arrow = active ? (currentSort.dir === "asc" ? "↑" : "↓") : "";
          return `<button class="cv-hub-sort-pill ${active ? "active" : ""}" data-sort="${pill.value}">${pill.label} ${arrow}</button>`;
        })
        .join("")}
    </div>
    <div class="cv-base-card">
      <h3>Base CV</h3>
      <p>Edit and save your master CV. Changes are used as a baseline for tailoring.</p>
      <p class="cv-base-hint" style="font-size:12px;color:#64748b;margin:0 0 12px;padding:8px 12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">Sections above (Summary, Achievements, Vistra, Ebury) are tailored per job. Roles below Ebury are fixed across all applications.</p>
      <div class="cv-base-sections">
        ${sectionDefs
          .map((sec) => {
            const content = sec.isArray ? formatList(base[sec.key]) : formatInlineText(String(base[sec.key] || ""));
            return `
              <details class="cv-base-section">
                <summary class="cv-base-section__header">
                  <h4>${sec.label}</h4>
                  <button class="btn btn-tertiary cv-base-edit-btn" data-cv-key="${sec.key}">Edit</button>
                </summary>
                <div class="cv-base-content" data-cv-key="${sec.key}">${content}</div>
              </details>
            `;
          })
          .join("")}
      </div>
    </div>
  `;

  displayJobs.forEach((job) => {
    const tailoredSections = job.tailored_cv_sections || {};
    const changedCount = sectionDefs.filter((sec) => {
      const tv = tailoredSections[sec.key];
      if (!tv) return false;
      return JSON.stringify(tv) !== JSON.stringify(base[sec.key]);
    }).length;
    const hasTailored = changedCount > 0;
    const hasCover = Boolean(job.cover_letter);
    const hasReqs = Array.isArray(job.key_requirements) && job.key_requirements.length > 0;

    html += `
      <div class="cv-pack-card hub-card" data-job-id="${escapeHtml(job.id)}">
        <div class="cv-pack-card__header">
          <div>
            <h3>${escapeHtml(job.role)}</h3>
            <p>${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p>
          </div>
          <div class="cv-pack-card__summary">
            ${hasTailored ? `<span class="cv-pack-tag cv-pack-tag--changed">${changedCount} section${changedCount !== 1 ? "s" : ""} tailored</span>` : ""}
            ${hasCover ? '<span class="cv-pack-tag cv-pack-tag--changed">Cover letter ready</span>' : ""}
            ${hasReqs ? `<span class="cv-pack-tag">${job.key_requirements.length} requirements</span>` : ""}
          </div>
        </div>

        <details class="hub-card__section cv-pack-section" data-section="cv_diff">
          <summary><h4>CV Differences</h4></summary>
          <div class="hub-card__content">
            <div class="cv-diff">${buildSideBySideDiff(job)}</div>
            ${hasTailored
              ? sectionDefs
                  .map((sec) => {
                    const tv = tailoredSections[sec.key];
                    if (!tv || JSON.stringify(tv) === JSON.stringify(state.baseCvSections[sec.key])) return "";
                    return `<button class="btn btn-tertiary cv-pack-edit-section" data-job-id="${escapeHtml(job.id)}" data-cv-key="${sec.key}" data-is-array="${sec.isArray}">Edit ${sec.label}</button>`;
                  })
                  .join("")
              : ""}
          </div>
        </details>

        ${hasCover
          ? `
        <details class="hub-card__section cv-pack-section" data-section="cover_letter">
          <summary><h4>Cover Letter</h4></summary>
          <div class="hub-card__content">
            <div class="cv-pack-cover-letter long-text">${formatInlineText(job.cover_letter)}</div>
            <button class="btn btn-tertiary cv-pack-edit-cover" data-job-id="${escapeHtml(job.id)}">Edit</button>
          </div>
        </details>`
          : ""}

        ${hasReqs
          ? `
        <details class="hub-card__section cv-pack-section" data-section="requirements">
          <summary><h4>Key Requirements Match</h4></summary>
          <div class="hub-card__content">${formatList(job.key_requirements)}</div>
        </details>`
          : ""}

        ${job.tailored_summary
          ? `
        <details class="hub-card__section cv-pack-section" data-section="tailored_summary">
          <summary><h4>Tailored Summary</h4></summary>
          <div class="hub-card__content">
            <div class="cv-pack-summary">${formatInlineText(job.tailored_summary)}</div>
            <button class="btn btn-tertiary cv-pack-edit-summary" data-job-id="${escapeHtml(job.id)}">Edit</button>
          </div>
        </details>`
          : ""}

        <div class="hub-card__actions">
          <button class="btn btn-primary cv-pack-download-full" data-job-id="${escapeHtml(job.id)}">Download Full Pack</button>
          <button class="btn btn-secondary cv-pack-download-cv" data-job-id="${escapeHtml(job.id)}">Download CV PDF</button>
          <button class="btn btn-tertiary cv-pack-preview" data-job-id="${escapeHtml(job.id)}">Preview</button>
          <button class="btn btn-tertiary cv-pack-copy-cv" data-job-id="${escapeHtml(job.id)}">Copy CV Text</button>
          <button class="btn btn-tertiary cv-pack-compare" data-job-id="${escapeHtml(job.id)}">Compare vs Base</button>
        </div>
        <div class="cv-pack-compare-container" data-job-id="${escapeHtml(job.id)}"></div>
      </div>
    `;
  });

  if (hasMore) {
    html += `<button class="btn btn-secondary cv-hub-show-more" style="width:100%;margin-top:16px;">Show more (${sortedJobs.length - cvHubShowCount} remaining)</button>`;
  }

  html += `<div class="cv-preview-modal">
    <div class="cv-preview-modal__backdrop"></div>
    <div class="cv-preview-modal__content">
      <div class="cv-preview-modal__header">
        <h3>CV Preview</h3>
        <button class="cv-preview-modal__close">&times;</button>
      </div>
      <div class="cv-preview-modal__body"></div>
    </div>
  </div>`;

  hub.innerHTML = html;

  hub.querySelectorAll(".hub-card__section").forEach((detailEl) => {
    const content = detailEl.querySelector(".hub-card__content");
    if (content) {
      content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    }
    detailEl.addEventListener("toggle", () => {
      if (content) content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    });
  });

  hub.querySelectorAll(".cv-base-section").forEach((detailEl) => {
    const content = detailEl.querySelector(".cv-base-content");
    if (content) {
      content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    }
    detailEl.addEventListener("toggle", () => {
      if (content) content.style.maxHeight = detailEl.open ? `${content.scrollHeight}px` : "0px";
    });
  });

  hub.querySelectorAll(".cv-hub-filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cvHubFilter = btn.dataset.filter;
      cvHubShowCount = 10;
      renderCvHub();
    });
  });

  hub.querySelectorAll(".cv-hub-sort-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.sort;
      if (state.cvHubSort.field === field) {
        state.cvHubSort.dir = state.cvHubSort.dir === "asc" ? "desc" : "asc";
      } else {
        state.cvHubSort.field = field;
        state.cvHubSort.dir = field === "company" ? "asc" : "desc";
      }
      saveCvHubSort(state.cvHubSort);
      cvHubShowCount = 10;
      renderCvHub();
    });
  });

  const showMoreBtn = hub.querySelector(".cv-hub-show-more");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", () => {
      cvHubShowCount += 10;
      renderCvHub();
    });
  }

  hub.querySelectorAll(".cv-base-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const key = btn.dataset.cvKey;
      const contentEl = hub.querySelector(`.cv-base-content[data-cv-key="${key}"]`);
      if (!contentEl) return;
      const isArray = Array.isArray(state.baseCvSections[key]);
      makeEditable(contentEl, {
        currentValue: state.baseCvSections[key],
        isArray,
        onSave: async (val) => {
          await saveBaseCvSection(key, val);
          renderCvHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  const baseDownloadBtn = hub.querySelector(".cv-base-download");
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

  const baseCopyBtn = hub.querySelector(".cv-base-copy");
  if (baseCopyBtn) {
    baseCopyBtn.addEventListener("click", () => {
      copyToClipboard(getTailoredCvPlainText({ tailored_cv_sections: {} }));
    });
  }

  const openPreviewModal = (jobOrEmpty) => {
    const modal = hub.querySelector(".cv-preview-modal");
    if (!modal) return;
    const body = modal.querySelector(".cv-preview-modal__body");
    body.innerHTML = "";
    const cvEl = buildTailoredCvHtml(jobOrEmpty);
    body.appendChild(cvEl);
    modal.classList.add("cv-preview-modal--visible");
  };

  const closePreviewModal = () => {
    const modal = hub.querySelector(".cv-preview-modal");
    if (!modal) return;
    modal.classList.remove("cv-preview-modal--visible");
  };

  const modal = hub.querySelector(".cv-preview-modal");
  if (modal) {
    modal.querySelector(".cv-preview-modal__backdrop")?.addEventListener("click", closePreviewModal);
    modal.querySelector(".cv-preview-modal__close")?.addEventListener("click", closePreviewModal);
  }

  const basePreviewBtn = hub.querySelector(".cv-base-preview");
  if (basePreviewBtn) {
    basePreviewBtn.addEventListener("click", () => openPreviewModal({ tailored_cv_sections: {} }));
  }

  hub.querySelectorAll(".cv-pack-preview").forEach((btn) => {
    btn.addEventListener("click", () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.jobId);
      if (job) openPreviewModal(job);
    });
  });

  hub.querySelectorAll(".cv-pack-edit-section").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const key = btn.dataset.cvKey;
      const isArray = btn.dataset.isArray === "true";
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const tailored = job.tailored_cv_sections || {};
      const contentEl = btn.closest(".hub-card__content");
      if (!contentEl) return;
      makeEditable(contentEl, {
        currentValue: tailored[key] || state.baseCvSections[key],
        isArray,
        onSave: async (val) => {
          await saveTailoredCvSection(job, key, val);
          renderCvHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  hub.querySelectorAll(".cv-pack-edit-cover").forEach((btn) => {
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
          renderCvHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  hub.querySelectorAll(".cv-pack-edit-summary").forEach((btn) => {
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
          renderCvHub();
        },
      });
      contentEl.style.maxHeight = "none";
    });
  });

  hub.querySelectorAll(".cv-pack-download-full").forEach((btn) => {
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

  hub.querySelectorAll(".cv-pack-download-cv").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.jobId);
      if (!job) return;
      const cvEl = buildTailoredCvHtml(job);
      const filename = `CV_${job.company}_${job.role}.pdf`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const opt = { margin: [10, 10, 10, 10], filename, html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } };
      try {
        await renderPdfFromElement(cvEl, opt);
        showToast("CV downloaded");
      } catch (err) {
        console.error(err);
        showToast("Download failed");
      }
    });
  });

  hub.querySelectorAll(".cv-pack-copy-cv").forEach((btn) => {
    btn.addEventListener("click", () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.jobId);
      if (!job) return;
      copyToClipboard(getTailoredCvPlainText(job));
    });
  });

  hub.querySelectorAll(".cv-pack-compare").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.dataset.jobId;
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) return;
      const container = hub.querySelector(`.cv-pack-compare-container[data-job-id="${jobId}"]`);
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

  state.cvHubRendered = true;
};

// CV Hub merged into Application Hub — handler set in app.applyhub.js
