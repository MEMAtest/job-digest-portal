import {
  summaryLine,
  alertBanner,
  breadcrumbLine,
  refreshBtn,
  runNowBtn,
  runStatusLine,
  searchInput,
  minFitSelect,
  sourceSelect,
  sourceFamilySelect,
  locationSelect,
  statusSelect,
  ukOnlyCheckbox,
  prepCloseBtn,
  state,
  setDb,
  setProxyMode,
  useProxy,
  setCollectionNames,
  initializeApp,
  getFirestore,
  initializeFirestore,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  setDoc,
  getDoc,
  collectionName,
  statsCollection,
  suggestionsCollection,
  candidatePrepCollection,
  runRequestsCollection,
  notificationsCollection,
  db,
  escapeHtml,
  isRecoverableFirestoreError,
  showToast,
  applyQuickFilter,
  isPostedToday,
  resetFilters,
  getJobAtsFamily,
  getJobSourceFamily,
  lastUpdatedLabel,
  lastUpdatedFooter,
} from "./app.core.js";
import { renderFilters, renderJobs } from "./app.jobs.js";
import { renderApplyHub } from "./app.applyhub.js";
import { renderCvHub } from "./app.cvhub.js";
import { loadBaseCvFromFirestore } from "./app.cv.js";
import {
  renderDashboardStats,
  renderPipelineView,
  renderFollowUps,
  renderFollowUpBanner,
  renderTriagePrompt,
  renderSourceStats,
  renderRoleSuggestions,
  renderCandidatePrep,
  triggerFollowUpNotifications,
} from "./app.dashboard.js";
import { checkNewJobNotifications, checkFirestoreNotifications } from "./app.notifications.js";
import { closePrepMode, switchPrepTab } from "./app.prep.js";
import { closeTriageMode, handleTriageAction } from "./app.triage.js";

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
  if (tabId !== "live") {
    state.selectedJobs.clear();
    if (state.handlers.updateBulkBar) state.handlers.updateBulkBar();
  }
  // CV Hub rendered eagerly on load; the cvpage tab reveals it
};

const isSafariBrowser = () => {
  const ua = navigator.userAgent || "";
  return /safari/i.test(ua) && !/chrome|crios|android|edge|edg/i.test(ua);
};

const clearAlertBanner = () => {
  if (!alertBanner) return;
  alertBanner.classList.add("hidden");
  alertBanner.classList.remove("alert--warning");
  alertBanner.textContent = "";
};

const showProxyConfigBanner = (message) => {
  if (!alertBanner) return;
  alertBanner.classList.remove("hidden");
  alertBanner.classList.remove("alert--warning");
  alertBanner.innerHTML =
    message ||
    "<strong>Proxy not configured:</strong> Set <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> in Netlify env vars to enable the fallback.";
};

const ensureFirestoreConnection = () => {
  if (!window.FIREBASE_CONFIG) {
    throw new Error("Missing Firebase config. Add config.js first.");
  }
  if (db) return db;

  const app = initializeApp(window.FIREBASE_CONFIG);
  const firestore = isSafariBrowser()
    ? initializeFirestore(app, {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
      })
    : getFirestore(app);

  setDb(firestore);
  setCollectionNames({
    collectionName: window.FIREBASE_COLLECTION || "jobs",
    statsCollection: window.FIREBASE_STATS_COLLECTION || "job_stats",
    suggestionsCollection: window.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions",
    candidatePrepCollection: window.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep",
    runRequestsCollection: window.FIREBASE_RUN_REQUESTS_COLLECTION || "run_requests",
    notificationsCollection: window.FIREBASE_NOTIFICATIONS_COLLECTION || "notifications",
  });
  return firestore;
};

const fetchProxyJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
};

const applyLoadedJobs = async ({ jobs, stats, suggestions, candidatePrep }) => {
  state.jobs = jobs.map((job) => ({
    ...job,
    source_family: job.source_family || getJobSourceFamily(job),
    ats_family: job.ats_family || getJobAtsFamily(job),
  }));
  state.sources = new Set(state.jobs.map((job) => job.source).filter(Boolean));
  state.sourceFamilies = new Set(state.jobs.map((job) => job.source_family).filter(Boolean));
  state.locations = new Set(state.jobs.map((job) => job.location).filter(Boolean));

  await loadBaseCvFromFirestore();

  renderDashboardStats(jobs);
  renderPipelineView(jobs);
  renderFollowUps(jobs);
  renderFollowUpBanner(jobs);
  renderFilters();
  renderJobs();
  renderApplyHub();
  renderCvHub();
  renderTriagePrompt(jobs);

  const nowLabel = new Date().toLocaleString();
  const freshTodayCount = state.jobs.filter(
    (job) => (job.application_status || "saved").toLowerCase() !== "dismissed" && isPostedToday(job)
  ).length;
  summaryLine.textContent = `${jobs.length} roles loaded · ${freshTodayCount} fresh today · Last update ${nowLabel}`;
  if (lastUpdatedLabel) lastUpdatedLabel.textContent = `Updated: ${nowLabel}`;
  if (lastUpdatedFooter) lastUpdatedFooter.textContent = `Updated: ${nowLabel}`;

  if (stats && Array.isArray(stats)) {
    renderSourceStats(stats);
  }
  if (suggestions) {
    renderRoleSuggestions(suggestions);
  }
  if (candidatePrep) {
    state.candidatePrep = candidatePrep || {};
    renderCandidatePrep(candidatePrep);
  }
};

const loadJobsViaProxy = async () => {
  try {
    setProxyMode(true);
    const data = await fetchProxyJson("/.netlify/functions/jobs?limit=200");
    await applyLoadedJobs({
      jobs: data.jobs || [],
      stats: data.stats || [],
      suggestions: data.suggestions || null,
      candidatePrep: data.candidatePrep || null,
    });
    if (alertBanner && alertBanner.textContent.toLowerCase().includes("browser blocked firestore")) {
      clearAlertBanner();
    }
    return true;
  } catch (error) {
    console.error("Proxy load failed:", error);
    const message = String(error?.message || error || "");
    if (message.includes("FIREBASE_SERVICE_ACCOUNT_JSON")) {
      showProxyConfigBanner();
    }
    return false;
  }
};

const loadJobsDirect = async () => {
  const firestore = ensureFirestoreConnection();
  const jobsRef = collection(firestore, collectionName);
  const jobsQuery = query(jobsRef, orderBy("fit_score", "desc"), limit(200));
  const snapshot = await getDocs(jobsQuery);

  const jobs = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
    prep_questions: docSnap.data().prep_questions || [],
  }));

  const warnParts = [];
  let stats = null;
  let suggestions = null;
  let candidatePrep = null;

  try {
    const statsRef = collection(firestore, statsCollection);
    const statsQuery = query(statsRef, orderBy("date", "desc"), limit(7));
    const statsSnap = await getDocs(statsQuery);
    stats = statsSnap.docs.map((docSnap) => docSnap.data());
  } catch (error) {
    if (isRecoverableFirestoreError(error)) throw error;
    console.error(error);
    warnParts.push({ name: "source stats", error });
  }

  try {
    const suggestionsRef = collection(firestore, suggestionsCollection);
    const suggestionsQuery = query(suggestionsRef, orderBy("date", "desc"), limit(1));
    const suggestionsSnap = await getDocs(suggestionsQuery);
    suggestions = suggestionsSnap.docs[0]?.data() || null;
  } catch (error) {
    if (isRecoverableFirestoreError(error)) throw error;
    console.error(error);
    warnParts.push({ name: "role suggestions", error });
  }

  try {
    const prepRef = collection(firestore, candidatePrepCollection);
    const prepQuery = query(prepRef, orderBy("date", "desc"), limit(1));
    const prepSnap = await getDocs(prepQuery);
    candidatePrep = prepSnap.docs[0]?.data() || null;
  } catch (error) {
    if (isRecoverableFirestoreError(error)) throw error;
    console.error(error);
    warnParts.push({ name: "candidate prep", error });
  }

  setProxyMode(false);
  await applyLoadedJobs({ jobs, stats, suggestions, candidatePrep });

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

state.handlers.setActiveTab = setActiveTab;

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
  });
});

if (prepCloseBtn) {
  prepCloseBtn.addEventListener("click", closePrepMode);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const triageOverlay = document.getElementById("triage-overlay");
    if (triageOverlay && !triageOverlay.classList.contains("hidden")) {
      closeTriageMode();
    } else {
      closePrepMode();
    }
    return;
  }

  const triageOverlay = document.getElementById("triage-overlay");
  if (triageOverlay && !triageOverlay.classList.contains("hidden")) {
    const focusTag = (event.target.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(focusTag)) return;
    if (event.key === "ArrowLeft") {
      handleTriageAction("dismiss");
    } else if (event.key === "ArrowRight") {
      handleTriageAction("shortlist");
    } else if (event.key === "ArrowUp") {
      handleTriageAction("apply");
    } else if (event.key === " ") {
      event.preventDefault();
      handleTriageAction("skip");
    }
  }
});

document.querySelectorAll(".prep-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchPrepTab(btn.dataset.prepTab));
});

const manualLinkInput = document.getElementById("manual-link-input");
const manualLinkSubmit = document.getElementById("manual-link-submit");

const quickShortlisted = document.getElementById("quick-shortlisted");
const quickDismissed = document.getElementById("quick-dismissed");
const quickToday = document.getElementById("quick-today");
const quickAll = document.getElementById("quick-all");
if (quickAll) {
  quickAll.addEventListener("click", () => {
    resetFilters();
    renderJobs();
  });
}
if (quickToday) {
  quickToday.addEventListener("click", () => {
    applyQuickFilter({
      label: "Posted today",
      predicate: (job) => isPostedToday(job),
      status: "",
      resetFilters: true,
    });
  });
}
if (quickShortlisted) {
  quickShortlisted.addEventListener("click", () => {
    resetFilters({ keepStatus: true });
    if (statusSelect) statusSelect.value = "shortlisted";
    renderJobs();
  });
}
if (quickDismissed) {
  quickDismissed.addEventListener("click", () => {
    resetFilters({ keepStatus: true });
    if (statusSelect) statusSelect.value = "dismissed";
    renderJobs();
  });
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const triggerRunRequest = async () => {
  const firestore = ensureFirestoreConnection();
  const ref = doc(firestore, runRequestsCollection, "latest");
  await setDoc(ref, { status: "pending", requested_at: new Date().toISOString() });
  return ref;
};

const fetchRunStatusViaProxy = async () => {
  const data = await fetchProxyJson("/.netlify/functions/run-status?id=latest");
  return data?.data || null;
};

const pollRunStatus = async (ref) => {
  const start = Date.now();
  while (Date.now() - start <= 300000) {
    try {
      const data = useProxy ? await fetchRunStatusViaProxy() : (await getDoc(ref)).data();
      const status = data?.status;
      if (status === "running") {
        runStatusLine.textContent = "Running — fetching jobs…";
      } else if (status === "done") {
        runStatusLine.textContent = "Done — refreshing results…";
        return { status: "done", data };
      } else if (status === "error") {
        return { status: "error", data };
      } else {
        runStatusLine.textContent = "Run triggered — waiting for Mac watcher (~2 min)…";
      }
    } catch (error) {
      if (isRecoverableFirestoreError(error)) {
        setProxyMode(true);
        runStatusLine.textContent = "Browser blocked Firestore — using fallback polling…";
        await wait(1000);
        continue;
      }
      throw error;
    }

    await wait(10000);
  }

  return { status: "timeout", data: null };
};

if (manualLinkSubmit) {
  const submitManualLink = async () => {
    const link = manualLinkInput?.value?.trim() || "";
    if (!link) {
      showToast("Paste a job link first.");
      return;
    }
    try {
      new URL(link);
    } catch (_) {
      showToast("Please paste a valid URL.");
      return;
    }
    const id = `manual_${Date.now()}`;
    try {
      const firestore = ensureFirestoreConnection();
      await setDoc(doc(firestore, runRequestsCollection, id), {
        type: "manual_link",
        link,
        status: "pending",
        created_at: new Date().toISOString(),
      });
      if (manualLinkInput) manualLinkInput.value = "";
      await triggerRunRequest();
      showToast("Link queued and run triggered.");
    } catch (err) {
      console.error(err);
      showToast("Failed to queue link.");
    }
  };

  manualLinkSubmit.addEventListener("click", submitManualLink);
  manualLinkInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitManualLink();
    }
  });
}

setActiveTab("dashboard");

const loadJobs = async () => {
  summaryLine.textContent = "Fetching latest roles…";
  clearAlertBanner();

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
    if (useProxy) {
      const proxyOk = await loadJobsViaProxy();
      if (proxyOk) return;
    }

    await loadJobsDirect();
  } catch (error) {
    console.error(error);
    const message = error?.message || "Unknown error";
    if (isRecoverableFirestoreError(error)) {
      setProxyMode(true);
      summaryLine.textContent = "Browser blocked Firestore — using fallback.";
      const proxyOk = await loadJobsViaProxy();
      if (proxyOk) {
        if (alertBanner) {
          alertBanner.classList.remove("hidden");
          alertBanner.classList.add("alert--warning");
          alertBanner.innerHTML =
            "<strong>Browser blocked Firestore:</strong> Using the Netlify fallback for loading and refresh.";
        }
        return;
      }
      summaryLine.textContent = "Failed to load roles via fallback.";
      showProxyConfigBanner(
        "<strong>Browser blocked Firestore:</strong> Direct access failed and the proxy fallback is not available."
      );
      return;
    }
    summaryLine.textContent = `Failed to load roles: ${message}`;
    if (alertBanner) {
      alertBanner.classList.remove("hidden");
      const lower = String(message).toLowerCase();
      if (lower.includes("permissions")) {
        alertBanner.innerHTML =
          "<strong>Permission error:</strong> Update your Firestore rules to allow read access to the jobs collection.";
      } else {
        alertBanner.innerHTML = `<strong>Load error:</strong> ${escapeHtml(message)}`;
      }
    }
  }
};

refreshBtn.addEventListener("click", loadJobs);
searchInput.addEventListener("input", renderJobs);
minFitSelect.addEventListener("change", renderJobs);
sourceSelect.addEventListener("change", renderJobs);
if (sourceFamilySelect) sourceFamilySelect.addEventListener("change", renderJobs);
locationSelect.addEventListener("change", renderJobs);
statusSelect.addEventListener("change", renderJobs);
ukOnlyCheckbox.addEventListener("change", renderJobs);

runNowBtn.addEventListener("click", async () => {
  runNowBtn.disabled = true;
  runNowBtn.textContent = "Triggering…";
  runStatusLine.textContent = "Sending run request…";
  runStatusLine.classList.remove("hidden");

  try {
    const ref = await triggerRunRequest();
    const result = await pollRunStatus(ref);

    if (result.status === "done") {
      await loadJobs();
      runStatusLine.textContent = "Complete.";
    } else if (result.status === "error") {
      const tail = result.data?.error_tail ? `\n${result.data.error_tail}` : "";
      runStatusLine.textContent = `Run failed — check watcher log on Mac.${tail}`;
    } else if (result.status === "timeout") {
      runStatusLine.textContent = "Timed out — run may still complete in background.";
    }
  } catch (error) {
    console.error("Poll error:", error);
    const message = String(error?.message || error || "");
    if (message.toLowerCase().includes("missing firebase config")) {
      runStatusLine.textContent = "Missing Firebase config.";
    } else if (isRecoverableFirestoreError(error)) {
      setProxyMode(true);
      runStatusLine.textContent = "Browser blocked Firestore — refresh is using fallback.";
      const proxyOk = await loadJobsViaProxy();
      if (!proxyOk) {
        runStatusLine.textContent = "Polling failed and fallback refresh was unavailable.";
      }
    } else {
      runStatusLine.textContent = "Connection error during polling.";
    }
  } finally {
    runNowBtn.disabled = false;
    runNowBtn.textContent = "Run now";
  }
});

const loadJobsAndNotify = async () => {
  await loadJobs();
  if (state.jobs.length) {
    checkNewJobNotifications(state.jobs);
    await checkFirestoreNotifications();
    triggerFollowUpNotifications(state.jobs);
  }
};

loadJobsAndNotify();
