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
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export {
  initializeApp,
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
  where,
};

export const summaryLine = document.getElementById("summary-line");
export const jobsContainer = document.getElementById("jobs");
export const topPickContainer = document.getElementById("top-pick");
export const sourceStatsContainer = document.getElementById("source-stats");
export const refreshBtn = document.getElementById("refresh-btn");
export const runNowBtn = document.getElementById("run-now-btn");
export const runStatusLine = document.getElementById("run-status-line");
export const dashboardStatsContainer = document.getElementById("dashboard-stats");
export const breadcrumbLine = document.getElementById("breadcrumb");
export const alertBanner = document.getElementById("alert-banner");
export const followUpBanner = document.getElementById("follow-up-banner");
export const triagePrompt = document.getElementById("triage-prompt");
export const lastUpdatedLabel = document.getElementById("last-updated-label");
export const prepOverlay = document.getElementById("prep-overlay");
export const prepOverlayTitle = document.getElementById("prep-overlay-title");
export const prepOverlayMeta = document.getElementById("prep-overlay-meta");
export const prepOverlayContent = document.getElementById("prep-content");
export const prepCloseBtn = document.getElementById("prep-close");

export const searchInput = document.getElementById("search");
export const minFitSelect = document.getElementById("minFit");
export const sourceSelect = document.getElementById("source");
export const locationSelect = document.getElementById("location");
export const statusSelect = document.getElementById("status");
export const ukOnlyCheckbox = document.getElementById("ukOnly");

export let db = null;
export let collectionName = "jobs";
export let statsCollection = "job_stats";
export let suggestionsCollection = "role_suggestions";
export let candidatePrepCollection = "candidate_prep";
export let runRequestsCollection = "run_requests";
export let notificationsCollection = "notifications";

export const setDb = (value) => {
  db = value;
};

export const getDb = () => db;

export const setCollectionNames = (config = {}) => {
  collectionName = config.collectionName || collectionName;
  statsCollection = config.statsCollection || statsCollection;
  suggestionsCollection = config.suggestionsCollection || suggestionsCollection;
  candidatePrepCollection = config.candidatePrepCollection || candidatePrepCollection;
  runRequestsCollection = config.runRequestsCollection || runRequestsCollection;
  notificationsCollection = config.notificationsCollection || notificationsCollection;
};

export const state = {
  jobs: [],
  sources: new Set(),
  locations: new Set(),
  candidatePrep: {},
  roleSuggestions: null,
  activePrepJob: null,
  hubSort: null,
  hubNotesTimers: {},
  triageQueue: [],
  triageIndex: 0,
  triageStats: { dismissed: 0, shortlisted: 0, apply: 0 },
  triageLastAction: null,
  selectedJobs: new Set(),
  baseCvSections: null,
  cvHubSort: { field: "fit_score", dir: "desc" },
  cvHubFilter: "all",
  cvHubRendered: false,
  hubFilter: "all",
  handlers: {
    setActiveTab: null,
    renderJobs: null,
    renderApplyHub: null,
    renderCvHub: null,
    renderDashboardStats: null,
    renderPipelineView: null,
    renderFollowUps: null,
    renderFollowUpBanner: null,
    renderFilters: null,
    renderRoleSuggestions: null,
    renderSourceStats: null,
    renderCandidatePrep: null,
    renderTriagePrompt: null,
    getFilteredJobs: null,
    updateBulkBar: null,
  },
};

export const TRIAGE_PROMPT_THRESHOLD = 10;
export const NOTIFICATION_THRESHOLD = 80;
export const getTodayKey = () => new Date().toISOString().slice(0, 10);

export let quickFilterPredicate = null;
export let quickFilterLabel = "";
export let uniqueCompanyOnly = false;
const quickFilterBar = document.getElementById("quick-filter");

export const formatFitBadge = (score) => {
  if (score >= 80) return "badge badge--green";
  if (score >= 72) return "badge badge--blue";
  return "badge badge--amber";
};

export const formatDismissReason = (reason) => {
  if (!reason) return "";
  if (reason === "auto_stale") return "Auto-dismissed (stale)";
  if (reason.startsWith("auto_low_fit")) {
    const parts = reason.split("_");
    const threshold = parts[parts.length - 1];
    return `Auto-dismissed (fit below ${threshold}%)`;
  }
  return "Dismissed";
};

export const getLocationBadgeClass = (location) => {
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

export const formatPosted = (value) => {
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

export const isUkOrRemote = (location) => {
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

export const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return null;
};

export const escapeHtml = (value) => {
  if (!value) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

export const formatInlineText = (value) => {
  if (!value) return "";
  const safe = escapeHtml(String(value));
  return safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\\n/g, "<br>")
    .replace(/\r?\n/g, "<br>");
};

export const safeLocalStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
};

export const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // ignore storage failures (private mode, blocked storage)
  }
};

export const showToast = (message, duration = 2500) => {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));
  setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  }, duration);
};

export const showConfirmToast = (message, actionLabel, onConfirm, duration = 8000) => {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast toast--confirm";
  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  el.appendChild(msgSpan);
  const btn = document.createElement("button");
  btn.className = "toast__action";
  btn.textContent = actionLabel;
  const timer = setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  }, duration);
  btn.addEventListener("click", () => {
    clearTimeout(timer);
    onConfirm();
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 300);
  });
  el.appendChild(btn);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--visible"));
};

export const copyToClipboard = async (text) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard.");
  } catch (error) {
    console.error(error);
    showToast("Copy failed. Please select and copy manually.");
  }
};

const flattenItem = (item) => {
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    return Object.entries(item).map(([k, v]) => `**${k}:** ${v}`).join("\n");
  }
  const s = String(item).trim();
  // Detect Python dict string: {'Key': 'value', ...}
  const pairs = [...s.matchAll(/['"](\w[\w\s]*)['"]:\s*['"]([^'"]+)['"](?=\s*[,}])/g)];
  if (pairs.length >= 2) return pairs.map(([, k, v]) => `**${k}:** ${v}`).join("\n");
  return s;
};

export const normaliseList = (items) => {
  if (!items) return [];
  if (Array.isArray(items)) return items.map(flattenItem);
  if (typeof items === "string") {
    return items.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  return [flattenItem(items)];
};

export const formatList = (items) => {
  const list = normaliseList(items);
  if (!list.length) return "Not available yet.";
  return `<ul>${list
    .map((item) => {
      const cleaned = String(item).replace(/^\s*[•*-]\s+/, "");
      return `<li>${formatInlineText(cleaned)}</li>`;
    })
    .join("")}</ul>`;
};

export const parseApplicantCount = (value) => {
  if (!value) return null;
  const match = String(value).match(/(\d[\d,]*)/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
};

export const formatApplicantBadge = (text) => {
  if (!text) return "";
  const match = text.match(/(\d+)/);
  if (!match) return "";
  const num = parseInt(match[1], 10);
  const tooltip = escapeHtml(text);
  if (num >= 100) return `<span class="badge badge--applicants-red" title="${tooltip}">${num}+ applicants — Act fast</span>`;
  if (num >= 50) return `<span class="badge badge--applicants-amber" title="${tooltip}">${num}+ applicants</span>`;
  if (num > 0) return `<span class="badge badge--applicants-green" title="${tooltip}">${escapeHtml(text)}</span>`;
  return "";
};

export const clearQuickFilter = () => {
  quickFilterPredicate = null;
  quickFilterLabel = "";
  uniqueCompanyOnly = false;
  if (quickFilterBar) {
    quickFilterBar.classList.add("hidden");
    quickFilterBar.innerHTML = "";
  }
  if (state.handlers.renderJobs) state.handlers.renderJobs();
};

export const applyQuickFilter = ({ label, predicate, status, uniqueCompanies } = {}) => {
  quickFilterPredicate = predicate || null;
  quickFilterLabel = label || "";
  uniqueCompanyOnly = Boolean(uniqueCompanies);
  if (status !== undefined && statusSelect) {
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
  if (state.handlers.renderJobs) state.handlers.renderJobs();
  if (state.handlers.setActiveTab) state.handlers.setActiveTab("live");
};
