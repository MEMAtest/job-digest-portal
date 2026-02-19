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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const summaryLine = document.getElementById("summary-line");
const jobsContainer = document.getElementById("jobs");
const topPickContainer = document.getElementById("top-pick");
const refreshBtn = document.getElementById("refresh-btn");

const searchInput = document.getElementById("search");
const minFitSelect = document.getElementById("minFit");
const sourceSelect = document.getElementById("source");
const locationSelect = document.getElementById("location");
const statusSelect = document.getElementById("status");

let db = null;
let collectionName = "jobs";

const state = {
  jobs: [],
  sources: new Set(),
  locations: new Set(),
};

const formatFitBadge = (score) => {
  if (score >= 80) return "badge badge--green";
  if (score >= 72) return "badge badge--blue";
  return "badge badge--amber";
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
    <p class="job-card__meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)} · ${escapeHtml(job.posted)}</p>
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

  const filtered = state.jobs.filter((job) => {
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

    return matchesSearch && matchesFit && matchesSource && matchesLocation && matchesStatus;
  });

  jobsContainer.innerHTML = "";
  filtered.forEach((job) => {
    const prepList = job.prep_questions?.length
      ? `<ul>${job.prep_questions
          .map((question) => `<li>${escapeHtml(question)}</li>`)
          .join("")}</ul>`
      : "Not available yet.";

    const bulletList = formatList(job.tailored_cv_bullets || []);
    const requirementsList = formatList(job.key_requirements || []);
    const statusValue = (job.application_status || "saved").toLowerCase();
    const appliedDate = job.application_date ? job.application_date.slice(0, 10) : "";
    const lastTouchDate = job.last_touch_date ? job.last_touch_date.slice(0, 10) : "";

    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div class="job-card__header">
        <div>
          <div class="job-card__title">${escapeHtml(job.role)}</div>
          <div class="job-card__meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</div>
          <div class="job-card__meta">${escapeHtml(job.posted)} · ${escapeHtml(job.source)}</div>
          <div class="job-card__meta">Status: ${escapeHtml(statusValue)}</div>
        </div>
        <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
      </div>
      <div class="job-card__details">
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
          <div class="section-title">Key requirements</div>
          ${requirementsList}
        </div>
        <div class="detail-box">
          <div class="section-title">Match notes</div>
          <div>${escapeHtml(job.match_notes || "Not available yet.")}</div>
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
      <div class="job-card__actions">
        <a href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View & Apply</a>
      </div>
    `;
    jobsContainer.appendChild(card);

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

const loadJobs = async () => {
  summaryLine.textContent = "Fetching latest roles…";

  if (!window.FIREBASE_CONFIG) {
    summaryLine.textContent = "Missing Firebase config. Add config.js first.";
    return;
  }

  const app = initializeApp(window.FIREBASE_CONFIG);
  db = getFirestore(app);
  collectionName = window.FIREBASE_COLLECTION || "jobs";

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

  renderFilters();
  renderTopPick(jobs[0]);
  renderJobs();

  summaryLine.textContent = `${jobs.length} roles loaded · Last update ${new Date().toLocaleString()}`;
};

refreshBtn.addEventListener("click", loadJobs);
searchInput.addEventListener("input", renderJobs);
minFitSelect.addEventListener("change", renderJobs);
sourceSelect.addEventListener("change", renderJobs);
locationSelect.addEventListener("change", renderJobs);
statusSelect.addEventListener("change", renderJobs);

loadJobs();
