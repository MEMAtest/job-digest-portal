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
  locationSelect,
  statusSelect,
  ukOnlyCheckbox,
  prepCloseBtn,
  state,
  setDb,
  setCollectionNames,
  initializeApp,
  getFirestore,
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
  if (tabId === "cv" && !state.cvHubRendered && state.jobs.length) {
    renderCvHub();
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
    setDb(getFirestore(app));
    setCollectionNames({
      collectionName: window.FIREBASE_COLLECTION || "jobs",
      statsCollection: window.FIREBASE_STATS_COLLECTION || "job_stats",
      suggestionsCollection: window.FIREBASE_SUGGESTIONS_COLLECTION || "role_suggestions",
      candidatePrepCollection: window.FIREBASE_CANDIDATE_PREP_COLLECTION || "candidate_prep",
      runRequestsCollection: window.FIREBASE_RUN_REQUESTS_COLLECTION || "run_requests",
      notificationsCollection: window.FIREBASE_NOTIFICATIONS_COLLECTION || "notifications",
    });

    const jobsRef = collection(db, collectionName);
    const jobsQuery = query(jobsRef, orderBy("fit_score", "desc"), limit(200));
    const snapshot = await getDocs(jobsQuery);

    const jobs = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
      prep_questions: docSnap.data().prep_questions || [],
    }));

    state.jobs = jobs;
    state.sources = new Set(jobs.map((job) => job.source).filter(Boolean));
    state.locations = new Set(jobs.map((job) => job.location).filter(Boolean));

    await loadBaseCvFromFirestore();

    renderDashboardStats(jobs);
    renderPipelineView(jobs);
    renderFollowUps(jobs);
    renderFollowUpBanner(jobs);
    renderFilters();
    renderJobs();
    renderApplyHub();
    renderTriagePrompt(jobs);

    state.cvHubRendered = false;
    const cvTabActive = document
      .querySelector('.nav-item[data-tab="cv"]')
      ?.classList.contains("nav-item--active");
    if (cvTabActive) renderCvHub();

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
    const statsDocs = statsSnap.docs.map((docSnap) => docSnap.data());
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
    state.candidatePrep = prepDoc || {};
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
    try {
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
      } else if (Date.now() - start > 300000) {
        clearInterval(poll);
        runStatusLine.textContent = "Timed out — run may still complete in background.";
        runNowBtn.disabled = false;
        runNowBtn.textContent = "Run now";
      }
    } catch (err) {
      clearInterval(poll);
      console.error("Poll error:", err);
      runStatusLine.textContent = "Connection error during polling.";
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Run now";
    }
  }, 10000);
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
