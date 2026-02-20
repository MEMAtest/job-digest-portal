import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  orderBy,
  query,
  limit,
  updateDoc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const summaryLine = document.getElementById("summary-line");
const jobsContainer = document.getElementById("jobs");
const topPickContainer = document.getElementById("top-pick");
const sourceStatsContainer = document.getElementById("source-stats");
const roleSuggestionsContainer = document.getElementById("role-suggestions");
const candidatePrepContainer = document.getElementById("candidate-prep");
const refreshBtn = document.getElementById("refresh-btn");
const runNowBtn = document.getElementById("run-now-btn");
const runStatusLine = document.getElementById("run-status-line");
const dashboardStatsContainer = document.getElementById("dashboard-stats");
const breadcrumbLine = document.getElementById("breadcrumb");
const alertBanner = document.getElementById("alert-banner");

const searchInput = document.getElementById("search");
const minFitSelect = document.getElementById("minFit");
const sourceSelect = document.getElementById("source");
const locationSelect = document.getElementById("location");
const statusSelect = document.getElementById("status");
const ukOnlyCheckbox = document.getElementById("ukOnly");

let db = null;
let collectionName = "jobs";
let statsCollection = "job_stats";
let suggestionsCollection = "role_suggestions";
let candidatePrepCollection = "candidate_prep";
let runRequestsCollection = "run_requests";

const state = {
  jobs: [],
  sources: new Set(),
  locations: new Set(),
};

let quickFilterPredicate = null;
let quickFilterLabel = "";
let uniqueCompanyOnly = false;

const formatFitBadge = (score) => {
  if (score >= 80) return "badge badge--green";
  if (score >= 72) return "badge badge--blue";
  return "badge badge--amber";
};

const getLocationBadgeClass = (location) => {
  if (!location) return "badge badge--amber badge--location";
  const loc = location.toLowerCase();
  if (loc.includes("remote") || loc.includes("hybrid")) return "badge badge--green badge--location";
  if (
    loc.includes("london") ||
    loc.includes(" uk") ||
    loc.startsWith("uk") ||
    loc.includes("united kingdom") ||
    loc.includes("england") ||
    loc.includes("scotland") ||
    loc.includes("wales")
  )
    return "badge badge--blue badge--location";
  return "badge badge--amber badge--location";
};

const formatPosted = (value) => {
  if (!value) return "Date unavailable";
  const text = String(value);
  const lower = text.toLowerCase();
  if (lower.includes("ago") || lower.includes("yesterday") || lower.includes("today")) {
    return text;
  }
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return text;
};

const isUkOrRemote = (location) => {
  if (!location) return false;
  const loc = location.toLowerCase();
  return (
    loc.includes("london") ||
    loc.includes("uk") ||
    loc.includes("united kingdom") ||
    loc.includes("remote") ||
    loc.includes("hybrid") ||
    loc.includes("england") ||
    loc.includes("scotland") ||
    loc.includes("wales")
  );
};

const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return null;
};

const quickFilterBar = document.getElementById("quick-filter");

const clearQuickFilter = () => {
  quickFilterPredicate = null;
  quickFilterLabel = "";
  uniqueCompanyOnly = false;
  if (quickFilterBar) {
    quickFilterBar.classList.add("hidden");
    quickFilterBar.innerHTML = "";
  }
  renderJobs();
};

const applyQuickFilter = ({ label, predicate, status, uniqueCompanies } = {}) => {
  quickFilterPredicate = predicate || null;
  quickFilterLabel = label || "";
  uniqueCompanyOnly = Boolean(uniqueCompanies);
  if (status !== undefined) {
    statusSelect.value = status;
  }
  if (quickFilterBar) {
    if (!quickFilterLabel && !uniqueCompanyOnly) {
      quickFilterBar.classList.add("hidden");
      quickFilterBar.innerHTML = "";
    } else {
      const labelText = quickFilterLabel || (uniqueCompanyOnly ? "Unique companies only" : "Quick filter");
      quickFilterBar.classList.remove("hidden");
      quickFilterBar.innerHTML = `
        <div class="quick-filter__label">${escapeHtml(labelText)}</div>
        <button class="btn btn-tertiary quick-filter__clear">Clear</button>
      `;
      const clearBtn = quickFilterBar.querySelector(".quick-filter__clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", clearQuickFilter);
      }
    }
  }
  renderJobs();
  setActiveTab("live");
};

const escapeHtml = (value) => {
  if (!value) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const copyToClipboard = async (text) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    alert("Copied to clipboard.");
  } catch (error) {
    console.error(error);
    alert("Copy failed. Please select and copy manually.");
  }
};

const formatList = (items) => {
  if (!items || !items.length) return "Not available yet.";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
};

const renderFilters = () => {
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

const renderTopPick = (job) => {
  if (!job) {
    topPickContainer.classList.add("hidden");
    return;
  }

  topPickContainer.classList.remove("hidden");
  topPickContainer.innerHTML = `
    <div class="section-title">Top Pick</div>
    <h2>${escapeHtml(job.role)}</h2>
    <p class="job-card__meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)} · ${escapeHtml(
      formatPosted(job.posted)
    )}</p>
    <div class="job-card__details" style="margin-top:12px;">
      <div class="detail-box">
        <div class="section-title">Why you fit</div>
        <div>${escapeHtml(job.why_fit)}</div>
      </div>
      <div class="detail-box">
        <div class="section-title">Potential gaps</div>
        <div>${escapeHtml(job.cv_gap)}</div>
      </div>
    </div>
  `;
};

const renderJobs = () => {
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

    return (
      matchesSearch &&
      matchesFit &&
      matchesSource &&
      matchesLocation &&
      matchesStatus &&
      matchesUkOnly &&
      matchesQuick
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

  jobsContainer.innerHTML = "";
  filtered.forEach((job) => {
    const prepList = job.prep_questions?.length
      ? `<ul>${job.prep_questions
          .map((question) => `<li>${escapeHtml(question)}</li>`)
          .join("")}</ul>`
      : "Not available yet.";

    const bulletList = formatList(job.tailored_cv_bullets || []);
    const requirementsList = formatList(job.key_requirements || []);
    const talkingPoints = formatList(job.key_talking_points || []);
    const starStories = formatList(job.star_stories || []);
    const statusValue = (job.application_status || "saved").toLowerCase();
    const appliedDate = job.application_date ? job.application_date.slice(0, 10) : "";
    const lastTouchDate = job.last_touch_date ? job.last_touch_date.slice(0, 10) : "";

    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div class="job-card__header">
        <div>
          <div class="job-card__title">${escapeHtml(job.role)}</div>
          <div class="job-card__meta">${escapeHtml(job.company)}</div>
          <div class="job-card__meta">${escapeHtml(formatPosted(job.posted))} · ${escapeHtml(job.source)}</div>
          <div class="job-card__meta">Status: ${escapeHtml(statusValue)}</div>
        </div>
        <div class="job-card__badges">
          <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
          <div class="${getLocationBadgeClass(job.location)}" title="${escapeHtml(job.location)}">${escapeHtml(job.location || "Unknown")}</div>
          ${job.apply_method ? `<span class="badge badge--method">${escapeHtml(job.apply_method)}</span>` : ""}
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
        <div class="job-card__details detail-carousel" id="carousel-${escapeHtml(job.id)}">
        <div class="detail-box">
          <div class="section-title">Role summary</div>
          <div>${escapeHtml(job.role_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored summary</div>
          <div>${escapeHtml(job.tailored_summary || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Tailored CV bullets (ATS-ready)</div>
          ${bulletList}
          <button class="btn btn-tertiary copy-btn" data-copy-type="bullets" data-job-id="${escapeHtml(
            job.id
          )}">Copy bullets</button>
        </div>
        <div class="detail-box">
          <div class="section-title">Why you fit</div>
          <div>${escapeHtml(job.why_fit)}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Potential gaps</div>
          <div>${escapeHtml(job.cv_gap)}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">CV edits for this role</div>
          <div>${escapeHtml(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Key requirements</div>
          ${requirementsList}
        </div>
        <div class="detail-box">
          <div class="section-title">Match notes</div>
          <div>${escapeHtml(job.match_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Interview focus</div>
          <div>${escapeHtml(job.interview_focus || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Quick pitch</div>
          <div>${escapeHtml(job.quick_pitch || "Not available yet.")}</div>
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
          <div class="section-title">Company insights</div>
          <div>${escapeHtml(job.company_insights || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Prep questions</div>
          ${prepList}
        </div>
        <div class="detail-box">
          <div class="section-title">How to apply</div>
          <div>${escapeHtml(job.apply_tips || "Apply with CV tailored to onboarding + KYC impact.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">CV edits (exact changes)</div>
          <div>${escapeHtml(job.cv_edit_notes || "Not available yet.")}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Cover letter</div>
          <pre class="long-text">${escapeHtml(job.cover_letter || "Not available yet.")}</pre>
          <button class="btn btn-tertiary copy-btn" data-copy-type="cover_letter" data-job-id="${escapeHtml(
            job.id
          )}">Copy cover letter</button>
        </div>
        <div class="detail-box tracking">
          <div class="section-title">Application tracking</div>
          <div class="tracking-grid">
            <label>Status</label>
            <select class="tracking-status">
              <option value="saved" ${statusValue === "saved" ? "selected" : ""}>Saved</option>
              <option value="applied" ${statusValue === "applied" ? "selected" : ""}>Applied</option>
              <option value="interview" ${statusValue === "interview" ? "selected" : ""}>Interview</option>
              <option value="offer" ${statusValue === "offer" ? "selected" : ""}>Offer</option>
              <option value="rejected" ${statusValue === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
            <label>Applied date</label>
            <input type="date" class="tracking-applied" value="${appliedDate}" />
            <label>Last touch</label>
            <input type="date" class="tracking-last-touch" value="${lastTouchDate}" />
            <label>Next action</label>
            <input type="text" class="tracking-next-action" value="${escapeHtml(
              job.next_action || ""
            )}" placeholder="e.g. Follow up email" />
            <label>Notes</label>
            <textarea class="tracking-notes" rows="3" placeholder="Notes...">${escapeHtml(
              job.application_notes || ""
            )}</textarea>
          </div>
          <button class="btn btn-primary save-tracking">Save update</button>
          <div class="tracking-status-msg"></div>
        </div>
        </div>
        <div class="carousel-dots" data-carousel-dots="${escapeHtml(job.id)}"></div>
      </div>
      <div class="job-card__actions">
        <a href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View & Apply</a>
      </div>
    `;
    jobsContainer.appendChild(card);

    const carousel = card.querySelector(".detail-carousel");
    const prevBtn = card.querySelector(".carousel-btn--prev");
    const nextBtn = card.querySelector(".carousel-btn--next");
    const dotsContainer = card.querySelector(".carousel-dots");

    const detailCards = carousel ? Array.from(carousel.querySelectorAll(".detail-box")) : [];

    const isMobile = window.matchMedia("(max-width: 900px)").matches;

    if (isMobile) {
      // Convert detail boxes into accordion items
      detailCards.forEach((box) => {
        const title = box.querySelector(".section-title");
        if (!title) return;
        // Wrap everything after the title in an accordion-body div
        const body = document.createElement("div");
        body.className = "accordion-body";
        while (title.nextSibling) {
          body.appendChild(title.nextSibling);
        }
        box.appendChild(body);
        // Tap title to toggle
        title.addEventListener("click", () => {
          box.classList.toggle("accordion-open");
        });
      });
    } else {
      // Desktop: carousel behavior
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

    const saveBtn = card.querySelector(".save-tracking");
    const statusEl = card.querySelector(".tracking-status");
    const appliedEl = card.querySelector(".tracking-applied");
    const lastTouchEl = card.querySelector(".tracking-last-touch");
    const nextActionEl = card.querySelector(".tracking-next-action");
    const notesEl = card.querySelector(".tracking-notes");
    const statusMsg = card.querySelector(".tracking-status-msg");

    saveBtn.addEventListener("click", async () => {
      if (!db) {
        statusMsg.textContent = "Missing Firebase config.";
        return;
      }
      const payload = {
        application_status: statusEl.value,
        application_date: appliedEl.value
          ? new Date(appliedEl.value).toISOString()
          : "",
        last_touch_date: lastTouchEl.value
          ? new Date(lastTouchEl.value).toISOString()
          : "",
        next_action: nextActionEl.value,
        application_notes: notesEl.value,
        updated_at: new Date().toISOString(),
      };
      try {
        await updateDoc(doc(db, collectionName, job.id), payload);
        job.application_status = payload.application_status;
        job.application_date = payload.application_date;
        job.last_touch_date = payload.last_touch_date;
        job.next_action = payload.next_action;
        job.application_notes = payload.application_notes;
        statusMsg.textContent = "Saved.";
      } catch (error) {
        console.error(error);
        statusMsg.textContent = "Save failed.";
      }
    });
  });

  if (!filtered.length) {
    jobsContainer.innerHTML = `<div class="detail-box">No roles match these filters yet. Try lowering the fit threshold or clearing filters.</div>`;
  }
};

const renderSourceStats = (statsDocs) => {
  if (!statsDocs.length) {
    sourceStatsContainer.innerHTML = "";
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

  sourceStatsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-card__label">Total (today)</div>
      <div class="stat-card__value">${total}</div>
      <div class="stat-card__trend">7‑day total: ${sevenDayTotal}</div>
    </div>
    ${cards}
  `;
};

const renderRoleSuggestions = (doc) => {
  if (!doc || !doc.roles || !doc.roles.length) {
    roleSuggestionsContainer.classList.add("hidden");
    roleSuggestionsContainer.innerHTML = "";
    return;
  }
  roleSuggestionsContainer.classList.remove("hidden");
  roleSuggestionsContainer.innerHTML = `
    <div class="section-title">Adjacent roles to consider</div>
    <div>${formatList(doc.roles)}</div>
    <div style="margin-top:8px;">${escapeHtml(doc.rationale || "")}</div>
  `;
};

const renderCandidatePrep = (doc) => {
  if (!doc) {
    candidatePrepContainer.classList.add("hidden");
    candidatePrepContainer.innerHTML = "";
    return;
  }
  candidatePrepContainer.classList.remove("hidden");
  candidatePrepContainer.innerHTML = `
    <div class="section-title">Your interview cheat sheet</div>
    <div><strong>Quick pitch</strong></div>
    <div>${escapeHtml(doc.quick_pitch || "Not available yet.")}</div>
    <div style="margin-top:8px;"><strong>Key stats</strong></div>
    ${formatList(doc.key_stats || [])}
    <div style="margin-top:8px;"><strong>Key talking points</strong></div>
    ${formatList(doc.key_talking_points || [])}
    <div style="margin-top:8px;"><strong>STAR stories (10/10)</strong></div>
    ${formatList(doc.star_stories || [])}
  `;
};

const renderDashboardStats = (jobs) => {
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
      <div class="stat-card__trend">Not yet applied</div>
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
        applyQuickFilter({ label: "Saved roles", status: "saved" });
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

const setActiveTab = (tabId) => {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-section").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.tab !== tabId);
  });
  if (breadcrumbLine) {
    const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    const label = activeBtn ? activeBtn.textContent.trim() : tabId;
    breadcrumbLine.textContent = `Home / ${label}`;
  }
};

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
  });
});

setActiveTab("dashboard");

const loadJobs = async () => {
  summaryLine.textContent = "Fetching latest roles…";
  if (alertBanner) {
    alertBanner.classList.add("hidden");
    alertBanner.textContent = "";
  }

  if (!window.FIREBASE_CONFIG) {
    summaryLine.textContent = "Missing Firebase config. Add config.js first.";
    if (alertBanner) {
      alertBanner.classList.remove("hidden");
      alertBanner.innerHTML =
        "<strong>Setup required:</strong> Add your Firebase config in <code>config.js</code>.";
    }
    return;
  }

  try {
    const app = initializeApp(window.FIREBASE_CONFIG);
    db = getFirestore(app);
    collectionName = window.FIREBASE_COLLECTION || "jobs";
    statsCollection = window.FIREBASE_STATS_COLLECTION || "job_stats";
    suggestionsCollection = window.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions";
    candidatePrepCollection = window.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep";
    runRequestsCollection = window.FIREBASE_RUN_REQUESTS_COLLECTION || "run_requests";

    const jobsRef = collection(db, collectionName);
    const jobsQuery = query(jobsRef, orderBy("fit_score", "desc"), limit(200));
    const snapshot = await getDocs(jobsQuery);

    const jobs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      prep_questions: doc.data().prep_questions || [],
    }));

    state.jobs = jobs;
    state.sources = new Set(jobs.map((job) => job.source).filter(Boolean));
    state.locations = new Set(jobs.map((job) => job.location).filter(Boolean));

    renderDashboardStats(jobs);
    renderFilters();
    renderTopPick(jobs[0]);
    renderJobs();

    summaryLine.textContent = `${jobs.length} roles loaded · Last update ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error(error);
    const message = error?.message || "Unknown error";
    summaryLine.textContent = `Failed to load roles: ${message}`;
    if (alertBanner) {
      alertBanner.classList.remove("hidden");
      if (String(message).toLowerCase().includes("permissions")) {
        alertBanner.innerHTML =
          "<strong>Permission error:</strong> Update your Firestore rules to allow read access to the jobs collection.";
      } else {
        alertBanner.innerHTML = `<strong>Load error:</strong> ${escapeHtml(message)}`;
      }
    }
    return;
  }

  const warnParts = [];
  try {
    const statsRef = collection(db, statsCollection);
    const statsQuery = query(statsRef, orderBy("date", "desc"), limit(7));
    const statsSnap = await getDocs(statsQuery);
    const statsDocs = statsSnap.docs.map((doc) => doc.data());
    renderSourceStats(statsDocs);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "source stats", error });
  }

  try {
    const suggestionsRef = collection(db, suggestionsCollection);
    const suggestionsQuery = query(suggestionsRef, orderBy("date", "desc"), limit(1));
    const suggestionsSnap = await getDocs(suggestionsQuery);
    const suggestionDoc = suggestionsSnap.docs[0]?.data();
    renderRoleSuggestions(suggestionDoc);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "role suggestions", error });
  }

  try {
    const prepRef = collection(db, candidatePrepCollection);
    const prepQuery = query(prepRef, orderBy("date", "desc"), limit(1));
    const prepSnap = await getDocs(prepQuery);
    const prepDoc = prepSnap.docs[0]?.data();
    renderCandidatePrep(prepDoc);
  } catch (error) {
    console.error(error);
    warnParts.push({ name: "candidate prep", error });
  }

  if (warnParts.length && alertBanner) {
    const detailList = warnParts
      .map((item) => {
        const message = item.error?.message || "Unknown error";
        return `<li>${escapeHtml(item.name)} — ${escapeHtml(message)}</li>`;
      })
      .join("");
    alertBanner.classList.remove("hidden");
    alertBanner.classList.add("alert--warning");
    alertBanner.innerHTML = `
      <strong>Limited data:</strong> Some collections could not load.
      <ul>${detailList}</ul>
      <div style="margin-top:6px;">Check Firestore rules for <code>job_stats</code>, <code>role_suggestions</code>, and <code>candidate_prep</code>.</div>
    `;
  }
};

refreshBtn.addEventListener("click", loadJobs);
searchInput.addEventListener("input", renderJobs);
minFitSelect.addEventListener("change", renderJobs);
sourceSelect.addEventListener("change", renderJobs);
locationSelect.addEventListener("change", renderJobs);
statusSelect.addEventListener("change", renderJobs);
ukOnlyCheckbox.addEventListener("change", renderJobs);

runNowBtn.addEventListener("click", async () => {
  if (!db) {
    runStatusLine.textContent = "Not connected.";
    runStatusLine.classList.remove("hidden");
    return;
  }
  runNowBtn.disabled = true;
  runNowBtn.textContent = "Triggering…";
  runStatusLine.textContent = "Sending run request…";
  runStatusLine.classList.remove("hidden");

  const ref = doc(db, runRequestsCollection, "latest");
  await setDoc(ref, { status: "pending", requested_at: new Date().toISOString() });

  runStatusLine.textContent = "Run triggered — waiting for Mac watcher (~2 min)…";
  const start = Date.now();
  const poll = setInterval(async () => {
    const snap = await getDoc(ref);
    const data = snap.data();
    const status = data?.status;
    if (status === "running") {
      runStatusLine.textContent = "Running — fetching jobs…";
    } else if (status === "done") {
      clearInterval(poll);
      runStatusLine.textContent = "Done — refreshing results…";
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Run now";
      await loadJobs();
      runStatusLine.textContent = "Complete.";
    } else if (status === "error") {
      clearInterval(poll);
      const tail = data?.error_tail ? `\n${data.error_tail}` : "";
      runStatusLine.textContent = `Run failed — check watcher log on Mac.${tail}`;
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Run now";
    } else if (Date.now() - start > 300_000) {
      clearInterval(poll);
      runStatusLine.textContent = "Timed out — run may still complete in background.";
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Run now";
    }
  }, 10_000);
});

loadJobs();
