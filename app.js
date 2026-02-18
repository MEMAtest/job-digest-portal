import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  orderBy,
  query,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const summaryLine = document.getElementById("summary-line");
const jobsContainer = document.getElementById("jobs");
const topPickContainer = document.getElementById("top-pick");
const refreshBtn = document.getElementById("refresh-btn");

const searchInput = document.getElementById("search");
const minFitSelect = document.getElementById("minFit");
const sourceSelect = document.getElementById("source");
const locationSelect = document.getElementById("location");

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

  const filtered = state.jobs.filter((job) => {
    const matchesSearch =
      !searchTerm ||
      job.role.toLowerCase().includes(searchTerm) ||
      job.company.toLowerCase().includes(searchTerm) ||
      job.why_fit.toLowerCase().includes(searchTerm);

    const matchesFit = job.fit_score >= minFit;
    const matchesSource = !sourceFilter || job.source === sourceFilter;
    const matchesLocation = !locationFilter || job.location === locationFilter;

    return matchesSearch && matchesFit && matchesSource && matchesLocation;
  });

  jobsContainer.innerHTML = "";
  filtered.forEach((job) => {
    const prepList = job.prep_questions?.length
      ? `<ul>${job.prep_questions
          .map((question) => `<li>${escapeHtml(question)}</li>`)
          .join("")}</ul>`
      : "Not available yet.";

    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div class="job-card__header">
        <div>
          <div class="job-card__title">${escapeHtml(job.role)}</div>
          <div class="job-card__meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</div>
          <div class="job-card__meta">${escapeHtml(job.posted)} · ${escapeHtml(job.source)}</div>
        </div>
        <div class="${formatFitBadge(job.fit_score)}">${job.fit_score}% fit</div>
      </div>
      <div class="job-card__details">
        <div class="detail-box">
          <div class="section-title">Why you fit</div>
          <div>${escapeHtml(job.why_fit)}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Potential gaps</div>
          <div>${escapeHtml(job.cv_gap)}</div>
        </div>
        <div class="detail-box">
          <div class="section-title">Prep questions</div>
          ${prepList}
        </div>
        <div class="detail-box">
          <div class="section-title">How to apply</div>
          <div>${escapeHtml(job.apply_tips || "Apply with CV tailored to onboarding + KYC impact.")}</div>
        </div>
      </div>
      <div class="job-card__actions">
        <a href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">View & Apply</a>
      </div>
    `;
    jobsContainer.appendChild(card);
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
  const db = getFirestore(app);

  const jobsRef = collection(db, window.FIREBASE_COLLECTION || "jobs");
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

loadJobs();
