import {
  state,
  db,
  collectionName,
  doc,
  getDoc,
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
import {
  getTailoredCvPlainText,
  buildTailoredCvHtml,
  renderPdfFromElement,
  hasCvTailoredChanges,
  getCvSectionDefinitions,
} from "./app.cv.js";
import {
  isApplyAssistantSupported,
  launchApplyAssistant,
  formatApplyAssistantStatus,
  isApplyAssistantBusy,
} from "./app.applyassistant.js";

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

const tailoringInFlight = new Set();

export const autoTailorCv = async (job) => {
  if (hasCvTailoredChanges(job)) return;
  if (tailoringInFlight.has(job.id)) return;
  tailoringInFlight.add(job.id);
  if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
  try {
    const res = await fetch("/.netlify/functions/generate-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");
    job.tailored_cv_sections = data.sections;
    showToast(`CV tailored for ${job.company}`);
  } catch (err) {
    showToast(`CV tailoring failed for ${job.company}`);
  } finally {
    tailoringInFlight.delete(job.id);
    if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
  }
};

export const resolveChecklistState = (job) => {
  const auto = {
    cv_tailored: hasCvTailoredChanges(job),
    cover_letter_reviewed: Boolean(job.cover_letter),
    requirements_matched: (job.fit_score || 0) >= 75 && Array.isArray(job.key_requirements) && job.key_requirements.length > 0,
    job_link_visited: false,
    application_form_prepared: Boolean(job.application_form_prepared_at || job.application_pack_generated_at),
    application_submitted: (job.application_status || "").toLowerCase() === "applied",
  };
  const existing = job.apply_checklist || {};
  const merged = { ...auto, ...existing };
  if ((job.application_status || "").toLowerCase() === "applied") {
    merged.application_submitted = true;
  }
  if (job.application_form_prepared_at || job.application_pack_generated_at) {
    merged.application_form_prepared = true;
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

  if (!db) return;
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
    await updateDoc(doc(db, collectionName, job.id), payload);
  } catch (error) {
    console.error("Checklist save failed:", error);
  }
};

const buildPreviewText = (html) => {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const text = (temp.textContent || "").trim();
  if (!text) return "";
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

const buildCvDiff = (job) => {
  const tailored = job.tailored_cv_sections || {};
  const sections = getCvSectionDefinitions();

  let html = "";
  for (const sec of sections) {
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
        <div class="cv-diff__label">${sec.label} — ${labelSuffix}</div>
        <div class="cv-diff__content">${content}</div>
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
    if (db) {
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
        if (state.handlers.renderJobs) state.handlers.renderJobs();
        if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
      });
    } else {
      showToast("Copied + opened link");
    }
  } else {
    showToast("Copied + opened link");
  }
};

// One-click apply (Part D): open the pre-filled form ready for the user to
// review + Submit. Reuses launchApplyAssistant (which ensures the pack and
// opens the local browser, NOT auto-submitting). Falls back to copy+open when
// the local assistant is offline so "Apply now" always does something useful.
export const applyNow = async (job) => {
  if (!job) return;
  if (isApplyAssistantSupported(job)) {
    if (isApplyAssistantBusy(job.id)) return;
    const result = await launchApplyAssistant(job, { autoSubmit: false });
    // launchApplyAssistant sets launch_failed (in memory + Firestore) and shows
    // a toast if the local server is down — fall back to copy + open the link.
    if (job.apply_assistant_status === "launch_failed") {
      showToast("Local assistant offline — copied your CV and opened the listing.");
      await quickApply(job);
    }
    return result;
  }
  // Unsupported ATS: copy tailored CV + cover letter and open the listing.
  await quickApply(job);
};

const HOT_LANE_MIN_FIT = 78;
const HOT_LANE_MAX_HOURS = 4;
const HOT_LANE_MAX_APPLICANTS = 25;

const hoursSincePosted = (job) => {
  const raw = job.posted_date || "";
  if (raw) {
    const t = Date.parse(raw.replace(" ", "T"));
    if (!Number.isNaN(t)) return (Date.now() - t) / 3600000;
  }
  const text = String(job.posted || job.posted_raw || "").toLowerCase();
  if (!text) return null;
  if (/\bnew\b|just now|today|minute|\bmins?\b/.test(text)) return 0.5;
  if (text.includes("yesterday")) return 24;
  const m = text.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (text.includes("hour")) return n;
  if (text.includes("day")) return n * 24;
  if (text.includes("week")) return n * 168;
  return null;
};

const isHotLaneJob = (job) => {
  const status = (job.application_status || "saved").toLowerCase();
  if (["applied", "rejected", "dismissed"].includes(status)) return false;
  if (!isApplyAssistantSupported(job)) return false;  // supported ATS + has link
  const hours = hoursSincePosted(job);
  if (hours === null || hours > HOT_LANE_MAX_HOURS) return false;
  if ((job.fit_score || 0) < HOT_LANE_MIN_FIT) return false;
  const n = parseApplicantCount(job.applicant_count);
  if (n !== null && n > HOT_LANE_MAX_APPLICANTS) return false;
  return true;
};

// Defensive portal hot lane (Part B): only renders into an optional #hot-lane
// container if present and there are qualifying roles. Never throws into the UI.
export const renderHotLane = () => {
  const container = document.getElementById("hot-lane");
  if (!container) return;
  const jobs = (state.jobs || [])
    .filter(isHotLaneJob)
    .sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0))
    .slice(0, 5);
  if (!jobs.length) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  const cards = jobs
    .map((job) => {
      const n = parseApplicantCount(job.applicant_count);
      const applicants = n !== null ? `${n} applicants` : "few applicants";
      const ready = job.apply_assistant_status === "pack_ready" ? "✓ Pack ready" : "";
      return `
        <div class="hot-lane__card">
          <div class="hot-lane__role">${escapeHtml(job.role || "Role")}</div>
          <div class="hot-lane__meta">${escapeHtml(job.company || "")} · ${escapeHtml(job.location || "")}</div>
          <div class="hot-lane__meta">Fit ${job.fit_score || 0}% · ${escapeHtml(applicants)} · ${escapeHtml(String(job.posted || ""))} <span class="hot-lane__ready">${ready}</span></div>
          <button class="btn-hot-apply" data-job-id="${escapeHtml(job.id)}">⚡ Apply now</button>
        </div>`;
    })
    .join("");
  container.style.display = "";
  container.innerHTML = `
    <div class="hot-lane__header">🔥 Apply now — fresh &amp; low-competition</div>
    ${cards}`;
  container.querySelectorAll(".btn-hot-apply").forEach((btn) => {
    btn.addEventListener("click", () => {
      const job = (state.jobs || []).find((j) => j.id === btn.dataset.jobId);
      if (job) applyNow(job);
    });
  });
};

// Deep link from the digest email / Telegram alert: #apply-now=<docId> opens
// one-click apply for that role as soon as jobs are loaded.
export const handleApplyNowDeepLink = async () => {
  const hash = window.location.hash || "";
  const match = hash.match(/apply-now=([A-Za-z0-9_-]+)/);
  if (!match) return;
  const jobId = match[1];
  try {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch (_) {
    // ignore
  }
  let job = (state.jobs || []).find((j) => j.id === jobId);
  // Brand-new alerted roles may not be in the (500-cap) loaded set yet — fetch
  // the doc directly by id and add it to state so the apply flow finds it.
  if (!job && db) {
    try {
      const snap = await getDoc(doc(db, collectionName, jobId));
      if (snap && snap.exists()) {
        job = { id: jobId, ...snap.data() };
        if (Array.isArray(state.jobs)) state.jobs.push(job);
      }
    } catch (err) {
      console.error("apply-now deep link fetch failed:", err);
    }
  }
  if (!job) {
    showToast("That role isn't loaded yet — open the Jobs tab and try again.");
    return;
  }
  showToast(`Opening one-click apply: ${job.role || "role"}`);
  await applyNow(job);
};

export const renderApplyHub = () => {
  const hubContainer = document.getElementById("apply-hub");
  if (!hubContainer) return;
  renderHotLane();

  const existingNotes = hubContainer.querySelectorAll?.(".hub-notes") || [];
  existingNotes.forEach((textarea) => {
    const jobId = textarea.dataset.jobId;
    if (!jobId) return;
    if (state.hubNotesTimers[jobId]) {
      clearTimeout(state.hubNotesTimers[jobId]);
      delete state.hubNotesTimers[jobId];
    }
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.application_notes = textarea.value.slice(0, 500);
  });

  const readyJobs = state.jobs.filter((j) => (j.application_status || "saved").toLowerCase() === "ready_to_apply");

  const appliedStatuses = ["applied", "interview", "offer"];
  const trackedJobs = state.jobs.filter((j) =>
    appliedStatuses.includes((j.application_status || "saved").toLowerCase())
  );

  if (!readyJobs.length && !trackedJobs.length) {
    hubContainer.innerHTML = `
      <div class="hub-empty">
        <h3>No jobs ready to apply</h3>
        <p>Use triage mode to mark jobs as "Apply" — they'll appear here with tailored CV diffs and quick actions.</p>
      </div>
    `;
    return;
  }

  const sortedReady = sortHubJobs(readyJobs);
  const sortedApplied = sortHubJobs(trackedJobs);

  const sortOptions = [
    { field: "fit_score", label: "Fit" },
    { field: "posted", label: "Date" },
    { field: "company", label: "Company" },
    { field: "applicant_count", label: "Applicants" },
  ];

  const currentSort = state.hubSort || { field: "fit_score", dir: "desc" };

  const renderHubCard = (job, isApplied) => {
    const statusValue = (job.application_status || "saved").toLowerCase();
    const checklist = resolveChecklistState(job);
    const checklistItems = [
      { key: "cv_tailored", label: "CV tailored" },
      { key: "cover_letter_reviewed", label: "Cover letter reviewed" },
      { key: "requirements_matched", label: "Requirements matched" },
      { key: "job_link_visited", label: "Job link visited" },
      { key: "application_form_prepared", label: "Application form prepared" },
      { key: "application_submitted", label: "Application submitted" },
    ];
    const readyCount = checklistItems.reduce((acc, item) => acc + (checklist[item.key] ? 1 : 0), 0);
    const readyTotal = checklistItems.length;
    const readyPct = Math.round((readyCount / readyTotal) * 100);
    const allReady = readyCount === readyTotal;
    const cvDiffHtml = buildCvDiff(job);
    const cvDiffPreview = buildPreviewText(cvDiffHtml);
    const summaryPreview = buildPreviewText(formatInlineText(job.tailored_summary || ""));
    const coverPreview = buildPreviewText(formatInlineText(job.cover_letter || ""));
    const requirementsPreview = buildPreviewText((job.key_requirements || []).map((req) => String(req)).join(" · "));
    const noteText = job.application_notes || "";
    const noteCount = Math.min(noteText.length, 500);
    const isTailoring = tailoringInFlight.has(job.id);
    const assistantSupported = isApplyAssistantSupported(job);
    const assistantBusy = isApplyAssistantBusy(job.id);
    const assistantStatus = formatApplyAssistantStatus(job);
    const actionLabel =
      statusValue === "applied" || statusValue === "interview" || statusValue === "offer"
        ? "Re-copy & Open"
        : allReady
        ? "Apply Now"
        : "Copy & View";
    return `
      <div class="hub-card${isApplied ? " hub-card--applied" : ""}${isTailoring ? " hub-card--tailoring" : ""}" data-job-id="${escapeHtml(job.id)}">
        <div class="hub-card__header">
          <div>
            <h3>${escapeHtml(job.role)}</h3>
            <p>${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p>
            ${assistantSupported ? `<div class="hub-card__assistant-status">Apply Assistant · ${escapeHtml(assistantStatus)}</div>` : ""}
          </div>
          <span class="${formatFitBadge(job.fit_score)}">${job.fit_score}%</span>
        </div>

        <div class="hub-card__progress">
          <div class="hub-progress__bar"><span style="width:${readyPct}%;"></span></div>
          <div class="hub-progress__label">${readyCount}/${readyTotal} ready</div>
        </div>

        <details class="hub-card__section" data-section="requirements" open>
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
            <h4>What Changed in Your CV</h4>
            <span class="hub-card__preview">${escapeHtml(cvDiffPreview || "CV diff ready once tailored.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="cv-diff">${cvDiffHtml}</div>
          </div>
        </details>

        <details class="hub-card__section" data-section="summary">
          <summary>
            <h4>Tailored Summary</h4>
            <span class="hub-card__preview">${escapeHtml(summaryPreview || "Summary will appear after enrichment.")}</span>
          </summary>
          <div class="hub-card__content">
            <div>${formatInlineText(job.tailored_summary || "")}</div>
          </div>
        </details>

        <details class="hub-card__section" data-section="cover_letter">
          <summary>
            <h4>Cover Letter</h4>
            <span class="hub-card__preview">${escapeHtml(coverPreview || "Cover letter not generated yet.")}</span>
          </summary>
          <div class="hub-card__content">
            <div class="long-text">${formatInlineText(job.cover_letter || "")}</div>
          </div>
        </details>

        <div class="hub-card__checklist">
          <div class="hub-checklist__title">Apply checklist</div>
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

        <div class="hub-card__actions">
          ${
            assistantSupported
              ? `<button class="btn btn-primary btn-apply-assistant" data-job-id="${escapeHtml(job.id)}" ${
                  assistantBusy ? "disabled" : ""
                }>${assistantBusy ? "Launching…" : "Apply Assistant"}</button>`
              : ""
          }
          <button class="btn btn-primary btn-quick-apply ${allReady ? "btn-quick-apply--ready" : ""}" data-job-id="${escapeHtml(job.id)}">${actionLabel}</button>
          ${isTailoring ? `<button class="btn btn-secondary generate-cv-btn" disabled><span class="tailoring-spinner"></span> Tailoring CV…</button>` : !hasCvTailoredChanges(job) ? `<button class="btn btn-secondary generate-cv-btn" data-job-id="${escapeHtml(job.id)}">Generate Tailored CV</button>` : ""}
          <button class="btn btn-secondary download-cv-btn" data-job-id="${escapeHtml(job.id)}">Download CV PDF</button>
          <button class="btn btn-tertiary copy-cv-text-btn" data-job-id="${escapeHtml(job.id)}">Copy CV text</button>
        </div>

        <div class="hub-card__notes">
          <label for="notes-${escapeHtml(job.id)}">Application notes</label>
          <textarea id="notes-${escapeHtml(job.id)}" class="hub-notes" data-job-id="${escapeHtml(job.id)}" maxlength="500" placeholder="Add notes — recruiter name, referral, conversation context...">${escapeHtml(noteText)}</textarea>
          <div class="hub-notes__meta">
            <span class="hub-notes__count">${noteCount}/500</span>
            <span class="hub-notes__saved hidden">Updated</span>
          </div>
        </div>
      </div>
    `;
  };

  let html = "";
  html += `
    <div class="hub-controls">
      <div class="hub-sort">
        ${sortOptions
          .map((opt) => {
            const active = currentSort.field === opt.field;
            const arrow = active ? (currentSort.dir === "asc" ? "↑" : "↓") : "";
            return `<button class="hub-sort__pill ${active ? "active" : ""}" data-sort="${opt.field}">${opt.label} ${arrow}</button>`;
          })
          .join("")}
      </div>
      <button class="btn btn-secondary hub-toggle" data-toggle="expand">Expand all</button>
    </div>
  `;

  if (sortedReady.length) {
    html += `<div class="section-title" style="margin-bottom:12px;">Ready to Apply (${sortedReady.length})</div>`;
    html += sortedReady.map((j) => renderHubCard(j, false)).join("");
  }
  if (sortedApplied.length) {
    html += `<div class="section-title" style="margin-top:24px;margin-bottom:12px;">Application Tracker (${sortedApplied.length})</div>`;
    html += sortedApplied.map((j) => renderHubCard(j, true)).join("");
  }

  hubContainer.innerHTML = html;

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
      renderApplyHub();
    });
  });

  const hubToggleBtn = hubContainer.querySelector(".hub-toggle");
  if (hubToggleBtn) {
    hubToggleBtn.addEventListener("click", () => {
      const details = hubContainer.querySelectorAll(".hub-card__section");
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

  hubContainer.querySelectorAll(".hub-card__section").forEach((detailEl) => {
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
    const sections = Array.from(hubContainer.querySelectorAll(".hub-card__section"));
    const openCount = sections.filter((d) => d.open).length;
    const allOpen = sections.length > 0 && openCount === sections.length;
    hubToggleBtn.dataset.toggle = allOpen ? "collapse" : "expand";
    hubToggleBtn.textContent = allOpen ? "Collapse all" : "Expand all";
  }

  hubContainer.querySelectorAll(".btn-quick-apply").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (job) btn.addEventListener("click", () => quickApply(job, btn.closest(".hub-card")));
  });

  hubContainer.querySelectorAll(".btn-apply-assistant").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", () => launchApplyAssistant(job));
  });

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

  hubContainer.querySelectorAll(".copy-cv-text-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) return;
    btn.addEventListener("click", () => {
      copyToClipboard(getTailoredCvPlainText(job));
      showToast("CV text copied");
    });
  });

  hubContainer.querySelectorAll(".generate-cv-btn").forEach((btn) => {
    const jobId = btn.dataset.jobId;
    btn.addEventListener("click", async () => {
      btn.textContent = "Generating...";
      btn.disabled = true;
      try {
        const res = await fetch("/.netlify/functions/generate-cv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Generation failed");
        const job = state.jobs.find((j) => j.id === jobId);
        if (job) job.tailored_cv_sections = data.sections;
        showToast("CV generated");
        renderApplyHub();
      } catch (err) {
        showToast("CV generation failed: " + err.message);
        btn.textContent = "Generate Tailored CV";
        btn.disabled = false;
      }
    });
  });

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
        if (!db) return;
        try {
          await updateDoc(doc(db, collectionName, jobId), {
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
