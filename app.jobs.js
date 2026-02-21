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
import { getTailoredCvPlainText, buildTailoredCvHtml, renderPdfFromElement } from "./app.cv.js";

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

export const renderJobs = () => {
  const filtered = getFilteredJobs();

  if (mobileNavObserver) {
    mobileNavObserver.disconnect();
    mobileNavObserver = null;
  }

  jobsContainer.innerHTML = "";
  const isMobile = window.matchMedia("(max-width: 900px)").matches;

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

  filtered.forEach((job) => {
    const bulletList = formatList(job.tailored_cv_bullets || []);
    const requirementsList = formatList(job.key_requirements || []);
    const talkingPoints = formatList(job.key_talking_points || []);
    const starStories = formatList(job.star_stories || []);
    const prepQaBlocks = buildPrepQa(job);
    const scorecardList = formatList(job.scorecard || []);
    const statusValue = (job.application_status || "saved").toLowerCase();
    const appliedDate = job.application_date ? job.application_date.slice(0, 10) : "";
    const lastTouchDate = job.last_touch_date ? job.last_touch_date.slice(0, 10) : "";
    const dismissNote = statusValue === "dismissed" ? formatDismissReason(job.dismiss_reason) : "";

    const card = document.createElement("div");
    card.className = "job-card";
    const postedDisplay = job.posted_raw || job.posted || "";
    const applicantDisplay = job.applicant_count ? ` · ${job.applicant_count} applicants` : "";
    const openStatus =
      job.job_status ||
      (job.is_open === true ? "Open" : "") ||
      (job.is_open === false ? "Closed" : "") ||
      (job.is_closed ? "Closed" : "");
    const statusSuffix = openStatus ? ` · ${openStatus}` : "";

    card.innerHTML = `
      <div class="job-card__header">
        <div class="job-card__info">
          <label class="bulk-check-label"><input type="checkbox" class="bulk-check" data-job-id="${escapeHtml(job.id)}" ${
      state.selectedJobs.has(job.id) ? "checked" : ""
    } /></label>
          <div class="job-card__text">
            <div class="job-card__title">${escapeHtml(job.role)}</div>
            <div class="job-card__company">${escapeHtml(job.company || "Company not listed")}</div>
            <div class="job-card__meta">${escapeHtml(formatPosted(postedDisplay))} · ${escapeHtml(job.source)}${escapeHtml(applicantDisplay)}${escapeHtml(statusSuffix)}</div>
            <div class="job-card__meta">Status: ${escapeHtml(statusValue)}${dismissNote ? ` · ${escapeHtml(dismissNote)}` : ""}</div>
          </div>
        </div>
        <div class="job-card__badges">
          <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
          <div class="${getLocationBadgeClass(job.location)}" title="${escapeHtml(job.location)}">${escapeHtml(job.location || "Unknown")}</div>
          ${job.apply_method ? `<span class="badge badge--method">${escapeHtml(job.apply_method)}</span>` : ""}
          ${formatApplicantBadge(job.applicant_count)}
        </div>
      </div>
      <div class="detail-carousel-wrap">
        <div class="detail-carousel-header">
          <div class="detail-carousel-hint">Swipe for more</div>
          <div class="detail-carousel-controls">
            <button class="carousel-btn carousel-btn--prev" aria-label="Previous card">&#x2039;</button>
            <button class="carousel-btn carousel-btn--next" aria-label="Next card">&#x203A;</button>
          </div>
        </div>
        <div class="detail-carousel-toolbar">
          <button class="btn btn-tertiary detail-toggle" type="button">Show all sections</button>
        </div>
        <div class="job-card__details detail-carousel" id="carousel-${escapeHtml(job.id)}">
        <div class="detail-box" data-section="role_summary">
          <div class="section-title">Role summary</div>
          <div>${formatInlineText(job.role_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="tailored_summary">
          <div class="section-title">Tailored summary</div>
          <div>${formatInlineText(job.tailored_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="tailored_bullets">
          <div class="section-title">Tailored CV bullets (ATS-ready)</div>
          ${bulletList}
          <button class="btn btn-tertiary copy-btn" data-copy-type="bullets" data-job-id="${escapeHtml(job.id)}">Copy bullets</button>
        </div>
        <div class="detail-box" data-section="why_fit">
          <div class="section-title">Why you fit</div>
          <div>${formatInlineText(job.why_fit || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="gaps">
          <div class="section-title">Potential gaps</div>
          <div>${formatInlineText(job.cv_gap || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="cv_edits">
          <div class="section-title">CV edits for this role</div>
          <div>${formatInlineText(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="key_requirements">
          <div class="section-title">Key requirements</div>
          ${requirementsList}
        </div>
        <div class="detail-box" data-section="match_notes">
          <div class="section-title">Match notes</div>
          <div>${formatInlineText(job.match_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="interview_focus">
          <div class="section-title">Interview focus</div>
          <div>${formatInlineText(job.interview_focus || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="quick_pitch">
          <div class="section-title">Quick pitch</div>
          <div>${formatInlineText(job.quick_pitch || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="talking_points">
          <div class="section-title">Key talking points</div>
          ${talkingPoints}
        </div>
        <div class="detail-box" data-section="star_stories">
          <div class="section-title">STAR stories (10/10)</div>
          ${starStories}
        </div>
        <div class="detail-box" data-section="company_insights">
          <div class="section-title">Company insights</div>
          <div>${formatInlineText(job.company_insights || "Not available yet.")}</div>
        </div>
        <div class="detail-box" data-section="interview_qa">
          <div class="section-title">Interview Q&amp;A (8–10/10)</div>
          ${prepQaBlocks}
        </div>
        <div class="detail-box" data-section="scorecard">
          <div class="section-title">Hiring scorecard</div>
          ${scorecardList}
        </div>
        <div class="detail-box" data-section="how_to_apply">
          <div class="section-title">How to apply</div>
          <div>${formatInlineText(job.apply_tips || "Apply with CV tailored to onboarding + KYC impact.")}</div>
        </div>
        <div class="detail-box" data-section="cover_letter">
          <div class="section-title">Cover letter</div>
          <div class="long-text">${formatInlineText(job.cover_letter || "Not available yet.")}</div>
          <button class="btn btn-tertiary copy-btn" data-copy-type="cover_letter" data-job-id="${escapeHtml(job.id)}">Copy cover letter</button>
        </div>
        <div class="detail-box" data-section="tailored_cv">
          <div class="section-title">Tailored CV</div>
          <div class="cv-preview" style="font-size:11px;color:#475569;margin-bottom:8px;">${
            job.tailored_cv_sections?.summary
              ? escapeHtml(job.tailored_cv_sections.summary).slice(0, 150) + "…"
              : "CV will be tailored with your profile. Download to preview."
          }</div>
          <button class="btn btn-primary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download PDF</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy as text</button>
        </div>
        <div class="detail-box tracking" data-section="tracking">
          <div class="section-title">Application tracking</div>
          <div class="tracking-grid">
            <label>Status</label>
            <select class="tracking-status">
              <option value="saved" ${statusValue === "saved" ? "selected" : ""}>Saved</option>
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
        <div class="carousel-dots" data-carousel-dots="${escapeHtml(job.id)}"></div>
      </div>
      <div class="job-card__actions">
        <button class="btn btn-quick-apply${
          statusValue !== "saved" && statusValue !== "shortlisted" && statusValue !== "ready_to_apply" ? " btn-quick-apply--done" : ""
        }">${statusValue === "applied" || statusValue === "interview" || statusValue === "offer" ? "Re-open" : "Apply now"}</button>
        <button class="btn btn-secondary btn-shortlist"${statusValue === "shortlisted" ? " disabled" : ""}>${
          statusValue === "shortlisted" ? "Shortlisted" : "Shortlist"
        }</button>
        <button class="btn btn-secondary btn-dismiss">Dismiss</button>
        <button class="btn btn-prep" data-job-id="${escapeHtml(job.id)}">Prep</button>
        <a href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View link</a>
      </div>
    `;
    jobsContainer.appendChild(card);

    const bulkCheck = card.querySelector(".bulk-check");
    if (bulkCheck) {
      bulkCheck.addEventListener("change", () => {
        if (bulkCheck.checked) {
          state.selectedJobs.add(job.id);
        } else {
          state.selectedJobs.delete(job.id);
        }
        updateBulkBar();
      });
    }

    const qaBtn = card.querySelector(".btn-quick-apply");
    if (qaBtn) {
      qaBtn.addEventListener("click", () => quickApply(job, card));
    }

    const shortlistBtn = card.querySelector(".btn-shortlist");
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
          shortlistBtn.classList.add("disabled");
          shortlistBtn.textContent = "Shortlisted";
          const trackingSelect = card.querySelector(".tracking-status");
          if (trackingSelect) trackingSelect.value = "shortlisted";
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = "Status: shortlisted";
          });
          showToast("Moved to Shortlisted");
        } catch (err) {
          console.error(err);
          showToast("Shortlist failed.");
        }
      });
    }

    const dismissBtn = card.querySelector(".btn-dismiss");
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
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = "Status: dismissed · manual";
          });
          showToast("Dismissed");
        } catch (err) {
          console.error(err);
          showToast("Dismiss failed.");
        }
      });
    }

    const prepBtn = card.querySelector(".btn-prep");
    if (prepBtn) {
      prepBtn.addEventListener("click", () => openPrepMode(prepBtn.dataset.jobId));
    }

    const carousel = card.querySelector(".detail-carousel");
    const prevBtn = card.querySelector(".carousel-btn--prev");
    const nextBtn = card.querySelector(".carousel-btn--next");
    const dotsContainer = card.querySelector(".carousel-dots");
    const detailToggle = card.querySelector(".detail-toggle");

    const detailCards = carousel ? Array.from(carousel.querySelectorAll(".detail-box")) : [];
    const essentialSections = new Set([
      "role_summary",
      "tailored_summary",
      "tailored_bullets",
      "why_fit",
      "key_requirements",
    ]);
    let detailExpanded = false;

    if (isMobile) {
      detailCards.forEach((box) => {
        const title = box.querySelector(".section-title");
        if (!title) return;
        const body = document.createElement("div");
        body.className = "accordion-body";
        while (title.nextSibling) {
          body.appendChild(title.nextSibling);
        }
        box.appendChild(body);
        title.addEventListener("click", () => {
          box.classList.toggle("accordion-open");
        });
      });

      const quickSaveBtn = document.createElement("button");
      quickSaveBtn.className = "quick-save-btn";
      const statusVal = (job.application_status || "saved").toLowerCase();
      if (statusVal === "saved") quickSaveBtn.classList.add("is-saved");
      quickSaveBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3.5L5 21V5z"/></svg>`;
      card.appendChild(quickSaveBtn);

      quickSaveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!db) return;
        const currentStatus = (job.application_status || "saved").toLowerCase();
        if (!["saved", "applied"].includes(currentStatus)) return;
        const wasSaved = quickSaveBtn.classList.contains("is-saved");
        const newStatus = wasSaved ? "applied" : "saved";

        quickSaveBtn.classList.toggle("is-saved");
        quickSaveBtn.classList.add("is-saving");

        try {
          await updateDoc(doc(db, collectionName, job.id), {
            application_status: newStatus,
            updated_at: new Date().toISOString(),
          });
          job.application_status = newStatus;
          const trackingSelect = card.querySelector(".tracking-status");
          if (trackingSelect) trackingSelect.value = newStatus;
          const metaDivs = card.querySelectorAll(".job-card__meta");
          metaDivs.forEach((m) => {
            if (m.textContent.startsWith("Status:")) m.textContent = `Status: ${newStatus}`;
          });
        } catch (err) {
          console.error("Quick-save failed:", err);
          quickSaveBtn.classList.toggle("is-saved");
        } finally {
          quickSaveBtn.classList.remove("is-saving");
        }
      });
    } else {
      detailCards.forEach((box) => {
        const key = box.dataset.section;
        if (!essentialSections.has(key)) {
          box.classList.add("detail-box--hidden");
        }
      });
      if (detailToggle) {
        detailToggle.addEventListener("click", () => {
          detailExpanded = !detailExpanded;
          detailCards.forEach((box) => {
            const key = box.dataset.section;
            if (!essentialSections.has(key)) {
              box.classList.toggle("detail-box--hidden", !detailExpanded);
            }
          });
          detailToggle.textContent = detailExpanded ? "Show key sections" : "Show all sections";
        });
      }

      // Desktop no longer uses the carousel buttons/dots.
      if (prevBtn) prevBtn.style.display = "none";
      if (nextBtn) nextBtn.style.display = "none";
      if (dotsContainer) dotsContainer.style.display = "none";

      const snapToIndex = (index) => {
        if (!carousel || !detailCards[index]) return;
        const target = detailCards[index];
        const left = target.offsetLeft - carousel.offsetLeft;
        carousel.scrollTo({ left, behavior: "smooth" });
      };

      const renderDots = () => {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = "";
        detailCards.forEach((_, idx) => {
          const dot = document.createElement("button");
          dot.className = "carousel-dot";
          dot.setAttribute("aria-label", `Go to card ${idx + 1}`);
          dot.addEventListener("click", () => snapToIndex(idx));
          dotsContainer.appendChild(dot);
        });
      };

      const updateActiveDot = () => {
        if (!carousel || !dotsContainer) return;
        const scrollLeft = carousel.scrollLeft;
        let activeIdx = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        detailCards.forEach((cardEl, idx) => {
          const distance = Math.abs(cardEl.offsetLeft - carousel.offsetLeft - scrollLeft);
          if (distance < bestDistance) {
            bestDistance = distance;
            activeIdx = idx;
          }
        });
        dotsContainer.querySelectorAll(".carousel-dot").forEach((dot, idx) => {
          dot.classList.toggle("active", idx === activeIdx);
        });
      };

      if (carousel) {
        renderDots();
        updateActiveDot();
        carousel.addEventListener("scroll", () => {
          window.requestAnimationFrame(updateActiveDot);
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          const active = dotsContainer?.querySelector(".carousel-dot.active");
          const idx = active ? Array.from(dotsContainer.children).indexOf(active) : 0;
          snapToIndex(Math.max(0, idx - 1));
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          const active = dotsContainer?.querySelector(".carousel-dot.active");
          const idx = active ? Array.from(dotsContainer.children).indexOf(active) : 0;
          snapToIndex(Math.min(detailCards.length - 1, idx + 1));
        });
      }
    }

    card.querySelectorAll(".copy-btn").forEach((btn) => {
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

    card.querySelectorAll(".prep-qa__select").forEach((select) => {
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

    const downloadCvBtn = card.querySelector(".download-cv-btn");
    if (downloadCvBtn) {
      downloadCvBtn.addEventListener("click", async () => {
        const target = state.jobs.find((item) => item.id === downloadCvBtn.dataset.jobId);
        if (!target) return;
        const htmlEl = buildTailoredCvHtml(target);
        const companySlug = (target.company || "Company").replace(/[^a-zA-Z0-9]/g, "");
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
    }

    const copyCvTextBtn = card.querySelector(".copy-cv-text-btn");
    if (copyCvTextBtn) {
      copyCvTextBtn.addEventListener("click", () => {
        const target = state.jobs.find((item) => item.id === copyCvTextBtn.dataset.jobId);
        if (!target) return;
        copyToClipboard(getTailoredCvPlainText(target));
      });
    }

    const saveBtn = card.querySelector(".save-tracking");
    const statusEl = card.querySelector(".tracking-status");
    const appliedEl = card.querySelector(".tracking-applied");
    const lastTouchEl = card.querySelector(".tracking-last-touch");
    const nextActionEl = card.querySelector(".tracking-next-action");
    const notesEl = card.querySelector(".tracking-notes");
    const salaryEl = card.querySelector(".tracking-salary");
    const appliedViaEl = card.querySelector(".tracking-applied-via");
    const followUpEl = card.querySelector(".tracking-follow-up");
    const interviewerNameEl = card.querySelector(".tracking-interviewer-name");
    const interviewerEmailEl = card.querySelector(".tracking-interviewer-email");
    const interviewDateEl = card.querySelector(".tracking-interview-date");
    const statusMsg = card.querySelector(".tracking-status-msg");
    const validationMsg = card.querySelector(".tracking-validation-msg");

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
        job.application_status = payload.application_status;
        job.application_date = payload.application_date;
        job.last_touch_date = payload.last_touch_date;
        job.next_action = payload.next_action;
        job.application_notes = payload.application_notes;
        job.salary_range = payload.salary_range;
        job.applied_via = payload.applied_via;
        job.follow_up_date = payload.follow_up_date;
        job.interviewer_name = payload.interviewer_name;
        job.interviewer_email = payload.interviewer_email;
        job.interview_date = payload.interview_date;
        statusMsg.textContent = "Saved.";
      } catch (error) {
        console.error(error);
        statusMsg.textContent = "Save failed.";
      }
    });
  });

  const existingNav = document.querySelector(".mobile-job-nav");
  if (existingNav) existingNav.remove();

  if (isMobile && filtered.length > 0) {
    const nav = document.createElement("div");
    nav.className = "mobile-job-nav";

    const prevBtn = document.createElement("button");
    prevBtn.className = "mobile-job-nav__btn";
    prevBtn.textContent = "\u2039";
    prevBtn.setAttribute("aria-label", "Previous job");

    const counter = document.createElement("span");
    counter.className = "mobile-job-nav__counter";
    counter.textContent = `1 of ${filtered.length}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "mobile-job-nav__btn";
    nextBtn.textContent = "\u203A";
    nextBtn.setAttribute("aria-label", "Next job");

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);

    jobsContainer.parentNode.insertBefore(nav, jobsContainer);

    const cards = Array.from(jobsContainer.querySelectorAll(".job-card"));
    let currentIndex = 0;

    const scrollToCard = (index) => {
      if (cards[index]) {
        cards[index].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      }
    };

    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) {
        currentIndex--;
        scrollToCard(currentIndex);
      }
    });

    nextBtn.addEventListener("click", () => {
      if (currentIndex < cards.length - 1) {
        currentIndex++;
        scrollToCard(currentIndex);
      }
    });

    mobileNavObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = cards.indexOf(entry.target);
            if (idx !== -1) {
              currentIndex = idx;
              counter.textContent = `${idx + 1} of ${filtered.length}`;
            }
          }
        });
      },
      { root: jobsContainer, threshold: 0.6 }
    );

    cards.forEach((c) => mobileNavObserver.observe(c));
  }

  if (!filtered.length) {
    jobsContainer.innerHTML = `<div class="detail-box">No roles match these filters yet. Try lowering the fit threshold or clearing filters.</div>`;
  }
};

state.handlers.renderJobs = renderJobs;
state.handlers.getFilteredJobs = getFilteredJobs;
state.handlers.updateBulkBar = updateBulkBar;
