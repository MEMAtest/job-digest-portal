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
