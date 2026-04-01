import { state, db, showToast, escapeHtml, formatInlineText } from "./app.core.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACCEPTED_TYPES = ["audio/mp4", "audio/m4a", "audio/mpeg", "audio/wav", "audio/webm", "video/mp4"];
const MAX_SIZE_MB = 200;

let _unsubscribe = null;

const stopPolling = () => {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
};

const scoreColour = (score) => {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#f59e0b";
  return "#ef4444";
};

const renderScoreBadge = (score) => {
  const colour = scoreColour(score);
  return `<span class="ir-score-badge" style="background:${colour}">${score}/10</span>`;
};

const renderAnalysis = (container, transcript, analysis) => {
  if (!analysis) {
    container.innerHTML = `<div class="detail-box">Analysis data missing.</div>`;
    return;
  }

  const dimensions = Array.isArray(analysis.dimension_scores) ? analysis.dimension_scores : [];
  const strengths = Array.isArray(analysis.strengths) ? analysis.strengths : [];
  const gaps = Array.isArray(analysis.gaps) ? analysis.gaps : [];
  const intel = Array.isArray(analysis.intelligence_gathered) ? analysis.intelligence_gathered : [];
  const prep = Array.isArray(analysis.next_round_prep) ? analysis.next_round_prep : [];

  const dimRows = dimensions.map((d) => `
    <tr>
      <td class="ir-dim-name">${escapeHtml(d.dimension || "")}</td>
      <td>
        <div class="ir-dim-bar">
          <div class="ir-dim-fill" style="width:${(d.score / 10) * 100}%;background:${scoreColour(d.score)}"></div>
        </div>
      </td>
      <td class="ir-dim-score" style="color:${scoreColour(d.score)}">${d.score}/10</td>
      <td class="ir-dim-note">${escapeHtml(d.note || "")}</td>
    </tr>
  `).join("");

  const listHtml = (items) => items.map((s) => `<li>${formatInlineText(s)}</li>`).join("");

  const intelHtml = intel.map((item) => `
    <div class="ir-intel-item">
      <div class="ir-intel-signal">${formatInlineText(item.signal || "")}</div>
      <div class="ir-intel-impl">${formatInlineText(item.implication || "")}</div>
    </div>
  `).join("");

  container.innerHTML = `
    <div class="ir-result">
      <div class="ir-overall">
        <div class="ir-overall-score" style="color:${scoreColour(analysis.overall_score)}">
          ${analysis.overall_score}/10
        </div>
        <div class="ir-overall-verdict">${formatInlineText(analysis.overall_verdict || "")}</div>
      </div>

      <div class="ir-section">
        <h3>Score breakdown</h3>
        <table class="ir-dim-table">
          <tbody>${dimRows}</tbody>
        </table>
      </div>

      ${analysis.core_gap_summary ? `
      <div class="ir-section ir-core-gap">
        <h3>Core gap</h3>
        <p>${formatInlineText(analysis.core_gap_summary)}</p>
      </div>` : ""}

      <div class="ir-two-col">
        <div class="ir-section">
          <h3>What went well</h3>
          <ul class="ir-list ir-list--green">${listHtml(strengths)}</ul>
        </div>
        <div class="ir-section">
          <h3>What to improve</h3>
          <ul class="ir-list ir-list--red">${listHtml(gaps)}</ul>
        </div>
      </div>

      ${intel.length ? `
      <div class="ir-section">
        <h3>Intelligence gathered</h3>
        ${intelHtml}
      </div>` : ""}

      ${prep.length ? `
      <div class="ir-section">
        <h3>Next round prep</h3>
        <ol class="ir-list ir-list--blue">${listHtml(prep)}</ol>
      </div>` : ""}

      <div class="ir-section">
        <h3>Full transcript</h3>
        <div class="ir-transcript">
          <button class="btn btn-ghost ir-transcript-toggle">Show transcript</button>
          <div class="ir-transcript-body hidden">${escapeHtml(transcript || "")}</div>
        </div>
      </div>

      <div class="ir-actions">
        <button class="btn btn-secondary ir-reupload">Upload new recording</button>
      </div>
    </div>
  `;

  container.querySelector(".ir-transcript-toggle")?.addEventListener("click", (e) => {
    const body = container.querySelector(".ir-transcript-body");
    const isHidden = body.classList.toggle("hidden");
    e.target.textContent = isHidden ? "Show transcript" : "Hide transcript";
  });

  container.querySelector(".ir-reupload")?.addEventListener("click", () => {
    renderUploadUi(container, state.activePrepJob);
  });
};

const renderProcessing = (container, message = "Analysing interview…") => {
  container.innerHTML = `
    <div class="ir-processing">
      <div class="ir-spinner"></div>
      <p>${escapeHtml(message)}</p>
      <p class="ir-processing-note">This usually takes 1–3 minutes for a 30-min recording.</p>
    </div>
  `;
};

const startPolling = (container, job) => {
  stopPolling();
  const jobRef = doc(db, "jobs", job.id);

  _unsubscribe = onSnapshot(jobRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const status = data.interview_status;

    if (status === "done") {
      stopPolling();
      const liveJob = state.jobs.find((j) => j.id === job.id) || job;
      liveJob.interview_transcript = data.interview_transcript || "";
      liveJob.interview_analysis = data.interview_analysis || null;
      liveJob.interview_status = "done";
      renderAnalysis(container, liveJob.interview_transcript, liveJob.interview_analysis);
    } else if (status === "error") {
      stopPolling();
      container.innerHTML = `
        <div class="ir-error">
          <p>Analysis failed: ${escapeHtml(data.interview_error || "Unknown error")}</p>
          <button class="btn btn-secondary ir-reupload-err">Try again</button>
        </div>
      `;
      container.querySelector(".ir-reupload-err")?.addEventListener("click", () => {
        renderUploadUi(container, job);
      });
    }
  });
};

const triggerAnalysis = async (container, job, storagePath) => {
  renderProcessing(container, "Transcribing and analysing…");
  startPolling(container, job);

  try {
    const response = await fetch("/.netlify/functions/analyse-interview-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, storagePath }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Background analysis did not start");
    }
  } catch (err) {
    stopPolling();
    showToast("Failed to start analysis: " + err.message);
    container.innerHTML = `
      <div class="ir-error">
        <p>Could not start interview analysis.</p>
        <button class="btn btn-secondary ir-reupload-err">Try again</button>
      </div>
    `;
    container.querySelector(".ir-reupload-err")?.addEventListener("click", () => {
      renderUploadUi(container, job);
    });
  }
};

const uploadAndAnalyse = async (container, job, file) => {
  const storage = getStorage(getApp());
  const path = `interviews/${job.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(storageRef, file);

  container.innerHTML = `
    <div class="ir-uploading">
      <p>Uploading recording…</p>
      <div class="ir-progress-bar"><div class="ir-progress-fill" style="width:0%"></div></div>
      <p class="ir-progress-pct">0%</p>
    </div>
  `;

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      const fill = container.querySelector(".ir-progress-fill");
      const label = container.querySelector(".ir-progress-pct");
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = `${pct}%`;
    },
    (err) => {
      showToast("Upload failed: " + err.message);
      renderUploadUi(container, job);
    },
    async () => {
      await triggerAnalysis(container, job, path);
    }
  );
};

const renderUploadUi = (container, job) => {
  stopPolling();
  container.innerHTML = `
    <div class="ir-upload">
      <div class="ir-upload-icon">🎙️</div>
      <h3>Upload interview recording</h3>
      <p>Upload an audio or video file of your interview. It will be transcribed and analysed against your CV and this role.</p>
      <label class="ir-file-label btn btn-primary">
        Choose file
        <input type="file" class="ir-file-input" accept="audio/*,video/mp4" style="display:none">
      </label>
      <p class="ir-file-hint">Supported: m4a, mp3, mp4, wav, webm · Max ${MAX_SIZE_MB}MB</p>
      <div class="ir-file-selected hidden">
        <span class="ir-file-name"></span>
        <button class="btn btn-primary ir-upload-btn">Analyse interview</button>
      </div>
    </div>
  `;

  let selectedFile = null;

  container.querySelector(".ir-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      showToast(`File too large. Max ${MAX_SIZE_MB}MB.`);
      return;
    }
    if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
      showToast("Unsupported file type. Use m4a, mp3, mp4, wav or webm.");
      return;
    }

    selectedFile = file;
    const nameEl = container.querySelector(".ir-file-name");
    const selectedEl = container.querySelector(".ir-file-selected");
    if (nameEl) nameEl.textContent = file.name;
    if (selectedEl) selectedEl.classList.remove("hidden");
  });

  container.querySelector(".ir-upload-btn")?.addEventListener("click", () => {
    if (!selectedFile) return;
    uploadAndAnalyse(container, job, selectedFile);
  });
};

export const renderInterviewReview = (container, job) => {
  stopPolling();

  if (job.interview_status === "processing") {
    renderProcessing(container);
    startPolling(container, job);
    return;
  }

  if (job.interview_status === "done" && job.interview_analysis) {
    renderAnalysis(container, job.interview_transcript || "", job.interview_analysis);
    return;
  }

  if (job.interview_status === "error") {
    container.innerHTML = `
      <div class="ir-error">
        <p>Analysis failed: ${escapeHtml(job.interview_error || "Unknown error")}</p>
        <button class="btn btn-secondary ir-reupload-err">Try again</button>
      </div>
    `;
    container.querySelector(".ir-reupload-err")?.addEventListener("click", () => {
      renderUploadUi(container, job);
    });
    return;
  }

  renderUploadUi(container, job);
};

export const cleanupInterviewReview = () => stopPolling();
