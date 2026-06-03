import {
  state,
  db,
  collectionName,
  doc,
  updateDoc,
  getJobAtsFamily,
  showToast,
} from "./app.core.js";

const LOCAL_ASSISTANT_BASE_URL = "http://127.0.0.1:4319";
const SUPPORTED_ASSISTANT_ATS = new Set(["Greenhouse", "Lever", "Ashby", "Workable"]);
const assistantInFlight = new Set();

export const isApplyAssistantSupported = (job) => {
  if (!job?.link) return false;
  return SUPPORTED_ASSISTANT_ATS.has(getJobAtsFamily(job));
};

export const isApplyAssistantBusy = (jobId) => assistantInFlight.has(jobId);

export const formatApplyAssistantStatus = (job) => {
  const status = String(job?.apply_assistant_status || "").trim();
  if (!status) return "Not started";
  if (status === "pack_ready") return "Pack ready";
  if (status === "launching") return "Launching local assistant";
  if (status === "review_required") return "Browser opened, review and submit manually";
  if (status === "launch_failed") return "Launch failed";
  if (status === "submitted_manually") return "Submitted manually";
  return status.replace(/_/g, " ");
};

const buildAssistantPayload = (job, packResponse) => ({
  jobId: job.id,
  jobUrl: job.link,
  atsFamily: getJobAtsFamily(job),
  company: job.company || "",
  role: job.role || "",
  location: job.location || "",
  pack: {
    ...packResponse.pack,
  },
});

const persistAssistantState = async (job, payload) => {
  Object.assign(job, payload);
  if (!db) return;
  await updateDoc(doc(db, collectionName, job.id), payload);
};

export const ensureApplicationPack = async (job) => {
  const res = await fetch("/.netlify/functions/generate-application-pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: job.id }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Application pack generation failed");
  }
  job.tailored_cv_sections = data.pack.tailoredCvSections || job.tailored_cv_sections;
  job.application_pack = data.pack.applicationPack;
  job.application_pack_generated_at = data.pack.applicationPack?.generated_at || new Date().toISOString();
  job.application_answers = data.pack.answers;
  job.apply_assistant_status = "pack_ready";
  return data;
};

const checkAssistantHealth = async () => {
  const res = await fetch(`${LOCAL_ASSISTANT_BASE_URL}/health`);
  if (!res.ok) throw new Error("Local assistant is not available");
  return res.json();
};

// Fast, non-throwing probe used to decide the apply path before any UI churn.
// On a phone the Mac's 127.0.0.1 is unreachable, so this returns false quickly
// (aborts after timeoutMs) instead of hanging on a connection that can't succeed.
export const isAssistantOnline = async (timeoutMs = 1500) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${LOCAL_ASSISTANT_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch (_) {
    return false;
  }
};

// Part E reliability: turn the silent "server down" failure into a visible,
// pre-emptive indicator. Updates an optional #assistant-health element so the
// user knows to start the local server before clicking Apply now.
let _assistantHealthTimer = null;
export const pollAssistantHealth = (intervalMs = 30000) => {
  const el = document.getElementById("assistant-health");
  if (!el) return;
  const update = async () => {
    let online = false;
    try {
      await checkAssistantHealth();
      online = true;
    } catch (_) {
      online = false;
    }
    el.classList.toggle("assistant-health--online", online);
    el.classList.toggle("assistant-health--offline", !online);
    el.textContent = online
      ? "● Apply Assistant online"
      : "● Assistant offline — run: npm run apply-assistant";
    el.title = online
      ? "Local one-click apply is ready"
      : "Start it from the repo root with: npm run apply-assistant";
  };
  update();
  if (_assistantHealthTimer) clearInterval(_assistantHealthTimer);
  _assistantHealthTimer = setInterval(update, intervalMs);
};

const buildChecklistUpdate = (job, result) => {
  const existing = job.apply_checklist || {};
  return {
    ...existing,
    job_link_visited: true,
    application_form_prepared: result?.status === "review_required" ? true : existing.application_form_prepared || false,
  };
};

export const launchApplyAssistant = async (job, options = {}) => {
  const { autoSubmit = false } = options;
  if (!job) return;
  if (!isApplyAssistantSupported(job)) {
    showToast("Apply Assistant supports Greenhouse, Lever, Ashby, and Workable only.");
    return;
  }
  if (assistantInFlight.has(job.id)) return;

  assistantInFlight.add(job.id);
  const rerender = () => {
    if (state.handlers.renderJobs) state.handlers.renderJobs();
    if (state.handlers.renderApplyHub) state.handlers.renderApplyHub();
  };

  try {
    await persistAssistantState(job, {
      apply_assistant_status: "launching",
      apply_assistant_last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rerender();

    const packResponse = await ensureApplicationPack(job);
    try {
      await checkAssistantHealth();
    } catch (_) {
      await persistAssistantState(job, {
        apply_assistant_status: "launch_failed",
        apply_assistant_last_result: {
          status: "server_unavailable",
          notes: ["Start the local server with: npm run apply-assistant"],
        },
        updated_at: new Date().toISOString(),
      });
      rerender();
      showToast("Local Apply Assistant not running. Start it with: npm run apply-assistant");
      return;
    }

    const endpoint = autoSubmit ? "/submit-approved" : "/start-application";
    const res = await fetch(`${LOCAL_ASSISTANT_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAssistantPayload(job, packResponse)),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || "Local assistant launch failed");
    }

    if (autoSubmit && result.status === "submitted") {
      const checklist = { ...(job.apply_checklist || {}), job_link_visited: true, application_submitted: true };
      await persistAssistantState(job, {
        apply_assistant_status: "submitted",
        auto_apply_status: "applied",
        apply_assistant_last_run_at: new Date().toISOString(),
        apply_assistant_last_result: result,
        apply_checklist: checklist,
        updated_at: new Date().toISOString(),
      });
      rerender();
      showToast("Application submitted successfully.");
      return;
    }

    const checklist = buildChecklistUpdate(job, result);
    await persistAssistantState(job, {
      apply_assistant_status: result.status || "review_required",
      apply_assistant_last_run_at: new Date().toISOString(),
      apply_assistant_last_result: result,
      apply_assistant_session_id: result.sessionId || "",
      application_form_prepared_at:
        result.status === "review_required" ? new Date().toISOString() : job.application_form_prepared_at || "",
      apply_checklist: checklist,
      updated_at: new Date().toISOString(),
    });
    rerender();
    showToast("Browser opened. Review the form and submit manually.");
    return result;
  } catch (error) {
    console.error("Apply Assistant launch failed:", error);
    await persistAssistantState(job, {
      apply_assistant_status: "launch_failed",
      apply_assistant_last_run_at: new Date().toISOString(),
      apply_assistant_last_result: {
        status: "launch_failed",
        error: error.message || "Launch failed",
      },
      updated_at: new Date().toISOString(),
    });
    rerender();
    showToast(error.message || "Apply Assistant launch failed");
  } finally {
    assistantInFlight.delete(job.id);
    rerender();
  }
};
