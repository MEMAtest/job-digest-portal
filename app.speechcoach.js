import {
  state,
  escapeHtml,
  showToast,
  safeLocalStorageGet,
  safeLocalStorageSet,
} from "./app.core.js";
import {
  FILLER_KEYS,
  buildSessionPayload,
  detectFillers,
  getScoreBand,
  mergeFillerCounts,
  selectQuestion,
} from "./app.speechcoach.logic.js";

const CATEGORIES = ["behavioural", "domain", "product", "scenario", "motivation", "curveball"];
const CATEGORY_LABELS = {
  behavioural: "Behavioural",
  domain: "Domain",
  product: "Product",
  scenario: "Scenario",
  motivation: "Motivation",
  curveball: "Curveball",
};
const MAX_SESSION_SECONDS = 120;
const MIN_SAVE_SECONDS = 5;
const SPEECH_DB_NAME = "speech-coach-store";
const QUEUE_STORE = "queuedSessions";

const emptyFillerCounts = () => Object.fromEntries(FILLER_KEYS.map((key) => [key, 0]));

const coach = {
  initialized: false,
  container: null,
  questions: [],
  questionsLoaded: false,
  questionsLoading: false,
  sessions: [],
  sessionsLoaded: false,
  selectedJobId: null,
  activeCategories: new Set(CATEGORIES),
  companyFilter: "",
  asked: new Set(),
  currentQuestion: null,
  status: "idle",
  warning: "",
  info: "",
  finalSegments: [],
  interimText: "",
  fillerCounts: emptyFillerCounts(),
  lastIncremented: "",
  flashUntil: 0,
  totalFillers: 0,
  timerStart: 0,
  duration: 0,
  timerId: null,
  maxStopId: null,
  stream: null,
  mediaRecorder: null,
  recorderChunks: [],
  recognition: null,
  recognitionActive: false,
  recognitionRestarts: 0,
  stopRequested: false,
  audioBlob: null,
  audioUrl: "",
  lastSession: null,
  expandedSessionId: "",
  audioUrls: {},
  historyCategory: "",
  historyJobOnly: false,
  lastVibrationAt: 0,
  lastFinalChunk: "",
  lastFinalAt: 0,
  beepEnabled: safeLocalStorageGet("speechCoach.beepEnabled") === "true",
  installPrompt: null,
};

const getSpeechRecognitionCtor = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const supportsSpeechRecognition = () => Boolean(getSpeechRecognitionCtor());
const supportsTts = () => Boolean(window.speechSynthesis);
const supportsMediaRecorder = () => Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
const isRecording = () => coach.status === "recording";
const isBusy = () => ["reading", "starting", "recording", "saving"].includes(coach.status);

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
};

const toTitle = (value) => CATEGORY_LABELS[value] || String(value || "").replace(/\b\w/g, (char) => char.toUpperCase());

const getSelectedJob = () => state.jobs.find((job) => job.id === coach.selectedJobId) || null;

const getJobLabel = (job) => {
  if (!job) return "General drill";
  return `${job.role || "Role"} · ${job.company || "Company"}`;
};

const truncate = (value, max = 120) => {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
};

const parseTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const seconds = value._seconds ?? value.seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatSessionDate = (session) => {
  const date = parseTimestamp(session.createdAtIso || session.createdAt);
  if (!date) return "Date unavailable";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const getSessionJob = (session) => state.jobs.find((job) => job.id === session.jobId) || null;

const buildQuery = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return query.toString();
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  return response.json();
};

const normalizeQuestion = (question) => ({
  id: String(question.id || question.questionId || crypto.randomUUID?.() || Math.random()),
  text: String(question.text || ""),
  category: String(question.category || "behavioural"),
  roleTag: Array.isArray(question.roleTag) ? question.roleTag : [],
  companyTag: Array.isArray(question.companyTag) ? question.companyTag : [],
  timesAsked: Number(question.timesAsked || 0),
  avgScore: Number(question.avgScore || 0),
  lastAskedAt: question.lastAskedAt || null,
});

const loadQuestions = async () => {
  if (coach.questionsLoading || coach.questionsLoaded) return;
  coach.questionsLoading = true;
  try {
    const data = await fetchJson("/.netlify/functions/speech-question-bank");
    coach.questions = (data.questions || []).map(normalizeQuestion).filter((question) => question.text);
    coach.questionsLoaded = true;
  } catch (error) {
    console.warn("Speech Coach question bank proxy failed, falling back to local JSON", error);
    try {
      const data = await fetchJson("/speech-questions.json");
      coach.questions = (Array.isArray(data) ? data : data.questions || []).map(normalizeQuestion).filter((question) => question.text);
      coach.questionsLoaded = true;
      coach.warning = "Using local question bank. Session scoring still works; question stats may not update until Netlify functions are available.";
    } catch (fallbackError) {
      console.error(fallbackError);
      coach.warning = "Question bank failed to load. Check the Netlify function and speech-questions.json.";
    }
  } finally {
    coach.questionsLoading = false;
    if (!coach.currentQuestion && coach.questions.length) pickNextQuestion({ silent: true });
    renderSpeechCoach();
  }
};

const loadSessions = async () => {
  try {
    const query = buildQuery({ limit: 50 });
    const data = await fetchJson(`/.netlify/functions/speech-sessions-list?${query}`);
    coach.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    coach.sessionsLoaded = true;
  } catch (error) {
    console.warn("Speech Coach history unavailable", error);
    coach.sessionsLoaded = false;
  } finally {
    renderSpeechCoach();
  }
};

const openQueueDb = () =>
  new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(SPEECH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });

const withQueueStore = async (mode, callback) => {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, mode);
    const store = tx.objectStore(QUEUE_STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
};

const queueSessionForRetry = async (session, audioBlob) => {
  await withQueueStore("readwrite", (store) => store.put({ id: session.id, session, audioBlob, queuedAt: new Date().toISOString() }));
};

const deleteQueuedSession = async (id) => {
  await withQueueStore("readwrite", (store) => store.delete(id));
};

const getQueuedSessions = async () => {
  try {
    const result = await withQueueStore("readonly", (store) => store.getAll());
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.warn("Queued speech sessions unavailable", error);
    return [];
  }
};

const uploadAudio = async (sessionId, audioBlob) => {
  if (!audioBlob || !audioBlob.size) return null;
  const response = await fetch("/.netlify/functions/speech-audio-upload", {
    method: "POST",
    headers: {
      "Content-Type": audioBlob.type || "audio/webm",
      "X-Session-Id": sessionId,
    },
    body: audioBlob,
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.audioRef || null;
};

const saveSessionDocument = async (session) => {
  const data = await fetchJson("/.netlify/functions/speech-session-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session }),
  });
  return data;
};

const persistSession = async (session, audioBlob) => {
  const audioRef = await uploadAudio(session.id, audioBlob);
  const payload = { ...session, audioRef: audioRef || session.audioRef || null, queuedOffline: false };
  const data = await saveSessionDocument(payload);
  return { session: data.session || payload, practiceStats: data.practiceStats || null };
};

const mergeSavedSession = (session, practiceStats = null) => {
  coach.sessions = [session, ...coach.sessions.filter((item) => item.id !== session.id)].slice(0, 50);
  if (session.jobId && practiceStats) {
    const job = state.jobs.find((item) => item.id === session.jobId);
    if (job) job.practiceStats = practiceStats;
  }
  if (state.handlers.renderJobs) state.handlers.renderJobs();
};

const retryQueuedSessions = async ({ visible = false } = {}) => {
  if (!navigator.onLine) return;
  const queued = await getQueuedSessions();
  if (!queued.length) {
    if (visible) showToast("No queued speech sessions.");
    return;
  }
  let saved = 0;
  for (const item of queued) {
    try {
      const result = await persistSession(item.session, item.audioBlob);
      await deleteQueuedSession(item.id);
      mergeSavedSession(result.session, result.practiceStats);
      saved += 1;
    } catch (error) {
      console.warn("Speech queue retry failed", error);
      break;
    }
  }
  if (saved) showToast(`${saved} speech session${saved > 1 ? "s" : ""} synced.`);
  renderSpeechCoach();
};

const pickNextQuestion = ({ silent = false } = {}) => {
  const result = selectQuestion(coach.questions, {
    categories: [...coach.activeCategories],
    company: coach.companyFilter,
    asked: coach.asked,
  });
  coach.currentQuestion = result.question;
  coach.asked = result.asked;
  if (result.reset && !silent) showToast("Question pool reset for this drill.");
  resetLiveState({ keepQuestion: true });
  renderSpeechCoach();
};

const resetLiveState = ({ keepQuestion = false } = {}) => {
  if (!keepQuestion) coach.currentQuestion = null;
  coach.finalSegments = [];
  coach.interimText = "";
  coach.fillerCounts = emptyFillerCounts();
  coach.lastIncremented = "";
  coach.flashUntil = 0;
  coach.totalFillers = 0;
  coach.duration = 0;
  coach.audioBlob = null;
  if (coach.audioUrl) URL.revokeObjectURL(coach.audioUrl);
  coach.audioUrl = "";
  coach.lastSession = null;
  coach.lastFinalChunk = "";
  coach.lastFinalAt = 0;
};

const getTranscriptText = () => coach.finalSegments.map((segment) => segment.text).join(" ").trim();

const commitVisibleInterimTranscript = () => {
  const interim = String(coach.interimText || "").trim();
  if (!interim) return;

  const finalText = getTranscriptText();
  const finalLower = finalText.toLowerCase();
  const interimLower = interim.toLowerCase();
  let textToCommit = interim;

  if (finalLower && finalLower.includes(interimLower)) {
    coach.interimText = "";
    return;
  }

  if (finalLower && interimLower.startsWith(finalLower)) {
    textToCommit = interim.slice(finalText.length).trim();
  }

  if (!textToCommit) {
    coach.interimText = "";
    return;
  }

  const detected = detectFillers(textToCommit);
  coach.fillerCounts = mergeFillerCounts(coach.fillerCounts, detected.counts);
  coach.totalFillers += detected.total;
  coach.finalSegments.push({ text: textToCommit, matches: detected.matches });
  coach.interimText = "";
};

const escapeSegmentWithHighlights = (text, matches = []) => {
  const sorted = [...matches].sort((left, right) => left.start - right.start || right.end - left.end);
  let cursor = 0;
  let html = "";
  for (const match of sorted) {
    if (match.start < cursor) continue;
    html += escapeHtml(text.slice(cursor, match.start));
    html += `<mark class="speech-filler-mark" title="${escapeHtml(match.filler)}">${escapeHtml(text.slice(match.start, match.end))}</mark>`;
    cursor = match.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
};

const renderTranscriptHtml = () => {
  const finalHtml = coach.finalSegments
    .map((segment) => `<span class="speech-transcript-final">${escapeSegmentWithHighlights(segment.text, segment.matches)}</span>`)
    .join(" ");
  const interimHtml = coach.interimText ? `<span class="speech-transcript-interim">${escapeHtml(coach.interimText)}</span>` : "";
  return finalHtml || interimHtml ? `${finalHtml} ${interimHtml}` : "<span class=\"speech-muted\">Transcript will appear here while you speak.</span>";
};

const renderStoredTranscript = (session) => {
  const text = String(session.transcript || "").trim();
  if (!text) return "<span class=\"speech-muted\">No transcript saved.</span>";
  const detected = detectFillers(text);
  return escapeSegmentWithHighlights(text, detected.matches);
};

const triggerAudioCue = () => {
  if (!coach.beepEnabled || !window.AudioContext) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, 80);
  } catch (error) {
    console.warn("Speech Coach audio cue failed", error);
  }
};

const triggerFillerFeedback = (filler) => {
  coach.lastIncremented = filler;
  coach.flashUntil = Date.now() + 800;
  const now = Date.now();
  if (navigator.vibrate && now - coach.lastVibrationAt > 200) {
    navigator.vibrate(60);
    coach.lastVibrationAt = now;
  }
  triggerAudioCue();
};

const processFinalTranscriptChunk = (chunk) => {
  const text = String(chunk || "").trim();
  if (!text) return;
  const now = Date.now();
  if (text === coach.lastFinalChunk && now - coach.lastFinalAt < 2000) return;
  coach.lastFinalChunk = text;
  coach.lastFinalAt = now;
  const detected = detectFillers(text);
  coach.fillerCounts = mergeFillerCounts(coach.fillerCounts, detected.counts);
  coach.totalFillers += detected.total;
  detected.matches.forEach((match) => triggerFillerFeedback(match.filler));
  coach.finalSegments.push({ text, matches: detected.matches });
};

const startRecognition = () => {
  const Recognition = getSpeechRecognitionCtor();
  if (!Recognition) {
    coach.warning = "Live feedback unavailable on this browser. Use Android Chrome for live highlighting.";
    return;
  }
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-GB";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript || "";
      if (result.isFinal) processFinalTranscriptChunk(transcript);
      else interim += transcript;
    }
    coach.interimText = interim;
    renderSpeechCoach();
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      coach.warning = "Mic or speech permission denied. In Android Chrome: site settings → microphone → allow, then retry.";
      coach.stopRequested = true;
      if (isRecording()) setTimeout(() => stopRecording({ interrupted: true, reason: "permission" }), 0);
    } else if (event.error !== "no-speech") {
      console.warn("Speech recognition error", event.error);
    }
  };
  recognition.onend = () => {
    coach.recognitionActive = false;
    if (coach.stopRequested || !isRecording()) return;
    if (coach.recognitionRestarts >= 3) {
      coach.warning = "Live speech recognition dropped repeatedly. Recording continues; final score uses captured transcript only.";
      renderSpeechCoach();
      return;
    }
    coach.recognitionRestarts += 1;
    setTimeout(() => {
      if (!coach.stopRequested && isRecording()) {
        try {
          recognition.start();
          coach.recognitionActive = true;
        } catch (error) {
          console.warn("Speech recognition restart failed", error);
        }
      }
    }, 250);
  };
  try {
    recognition.start();
    coach.recognitionActive = true;
    coach.recognition = recognition;
  } catch (error) {
    console.warn("Speech recognition start failed", error);
    coach.warning = "Live speech recognition failed to start. Audio recording can still run.";
  }
};

const startSpeechOnlyCapture = () => {
  resetLiveState({ keepQuestion: true });
  coach.warning = "Audio playback unavailable in this browser. Live transcript and scoring will still run.";
  coach.info = "Recording transcript only. Aim for 60–90 seconds and under 4 fillers per minute.";
  coach.stopRequested = false;
  coach.recognitionRestarts = 0;
  coach.timerStart = Date.now();
  coach.duration = 0;
  coach.status = "recording";
  startRecognition();
  coach.timerId = setInterval(() => {
    coach.duration = Math.round((Date.now() - coach.timerStart) / 1000);
    renderSpeechCoach();
  }, 500);
  coach.maxStopId = setTimeout(() => stopRecording({ interrupted: false, reason: "auto" }), MAX_SESSION_SECONDS * 1000);
  renderSpeechCoach();
};

const stopRecognition = () => {
  coach.stopRequested = true;
  if (!coach.recognition) return;
  try {
    coach.recognition.stop();
  } catch (error) {
    // Android Chrome can throw if the recognizer already stopped.
  }
  coach.recognition = null;
  coach.recognitionActive = false;
};

const chooseMimeType = () => {
  if (!window.MediaRecorder?.isTypeSupported) return "";
  return ["audio/webm; codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
};

const startCapture = async () => {
  if (!supportsMediaRecorder()) {
    if (supportsSpeechRecognition()) {
      startSpeechOnlyCapture();
      return;
    }
    coach.warning = "MediaRecorder, mic access, and live speech recognition are unavailable in this browser. Use Android Chrome.";
    renderSpeechCoach();
    return;
  }
  resetLiveState({ keepQuestion: true });
  coach.status = "starting";
  coach.warning = "";
  coach.info = "Requesting microphone permission…";
  renderSpeechCoach();

  try {
    coach.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(coach.stream, mimeType ? { mimeType } : undefined);
    coach.recorderChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) coach.recorderChunks.push(event.data);
    };
    recorder.start();
    coach.mediaRecorder = recorder;
    coach.stopRequested = false;
    coach.recognitionRestarts = 0;
    coach.timerStart = Date.now();
    coach.duration = 0;
    coach.status = "recording";
    coach.info = "Recording. Aim for 60–90 seconds and under 4 fillers per minute.";
    startRecognition();
    coach.timerId = setInterval(() => {
      coach.duration = Math.round((Date.now() - coach.timerStart) / 1000);
      renderSpeechCoach();
    }, 500);
    coach.maxStopId = setTimeout(() => stopRecording({ interrupted: false, reason: "auto" }), MAX_SESSION_SECONDS * 1000);
    renderSpeechCoach();
  } catch (error) {
    console.error(error);
    coach.status = "idle";
    coach.info = "";
    coach.warning = error.name === "NotAllowedError"
      ? "Mic permission denied. In Android Chrome: site settings → microphone → allow, then retry."
      : "Mic start failed. Check browser microphone access and retry.";
    renderSpeechCoach();
  }
};

const readQuestion = () =>
  new Promise((resolve) => {
    if (!supportsTts() || !coach.currentQuestion?.text) {
      resolve(false);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(coach.currentQuestion.text);
      utterance.lang = "en-GB";
      const voices = window.speechSynthesis.getVoices?.() || [];
      const voice = voices.find((item) => item.lang?.toLowerCase().startsWith("en-gb")) || voices.find((item) => item.lang?.toLowerCase().startsWith("en"));
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("TTS failed", error);
      resolve(false);
    }
  });

const beginSession = async ({ readFirst = true } = {}) => {
  if (isBusy()) return;
  if (!coach.currentQuestion) pickNextQuestion({ silent: true });
  if (!coach.currentQuestion) {
    showToast("No question available.");
    return;
  }
  if (readFirst && supportsTts()) {
    coach.status = "reading";
    coach.info = "Reading the question. Recording starts after the question finishes.";
    renderSpeechCoach();
    await readQuestion();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await startCapture();
};

const stopMediaRecorder = () =>
  new Promise((resolve) => {
    const recorder = coach.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      resolve();
      return;
    }
    recorder.onstop = () => resolve();
    try {
      recorder.stop();
    } catch (error) {
      resolve();
    }
  });

const stopRecording = async ({ interrupted = false, reason = "manual" } = {}) => {
  if (!isRecording() && coach.status !== "saving") return;
  const duration = Math.round((Date.now() - coach.timerStart) / 1000);
  coach.duration = duration;
  coach.status = "saving";
  coach.info = reason === "auto" ? "Auto-stopped at 120 seconds. Saving…" : "Saving session…";
  renderSpeechCoach();

  clearInterval(coach.timerId);
  clearTimeout(coach.maxStopId);
  coach.timerId = null;
  coach.maxStopId = null;
  stopRecognition();
  await stopMediaRecorder();
  if (coach.stream) coach.stream.getTracks().forEach((track) => track.stop());
  coach.stream = null;

  const recorderType = coach.mediaRecorder?.mimeType || "audio/webm";
  const audioBlob = coach.recorderChunks.length ? new Blob(coach.recorderChunks, { type: recorderType }) : null;
  coach.mediaRecorder = null;
  coach.audioBlob = audioBlob;
  if (coach.audioUrl) URL.revokeObjectURL(coach.audioUrl);
  coach.audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : "";

  commitVisibleInterimTranscript();
  const transcript = getTranscriptText();
  if (duration < MIN_SAVE_SECONDS || !transcript) {
    coach.status = "idle";
    coach.info = duration < MIN_SAVE_SECONDS ? "Not saved: answer was under 5 seconds." : "Not saved: no speech was captured.";
    coach.lastSession = null;
    renderSpeechCoach();
    return;
  }

  const session = buildSessionPayload({
    sessionId: crypto.randomUUID?.() || `speech-${Date.now()}`,
    jobId: coach.selectedJobId || null,
    question: coach.currentQuestion,
    transcript,
    webSpeechTranscript: transcript,
    duration,
    fillerCounts: coach.fillerCounts,
    audioRef: null,
    device: navigator.userAgent || "",
    interrupted,
  });
  coach.lastSession = session;
  renderSpeechCoach();

  try {
    const result = await persistSession(session, audioBlob);
    coach.lastSession = result.session;
    coach.status = "idle";
    coach.info = "Session saved.";
    mergeSavedSession(result.session, result.practiceStats);
    showToast("Speech session saved.");
  } catch (error) {
    console.error("Speech session save failed", error);
    const queuedSession = { ...session, queuedOffline: true };
    try {
      await queueSessionForRetry(queuedSession, audioBlob);
      coach.lastSession = queuedSession;
      coach.status = "idle";
      coach.warning = "Saved offline. The app will retry Firestore and audio upload when the network/function is available.";
      showToast("Saved offline; will sync later.");
    } catch (queueError) {
      console.error(queueError);
      coach.status = "idle";
      coach.warning = "Session could not be saved or queued. Keep the audio replay if needed, then retry.";
    }
  } finally {
    renderSpeechCoach();
  }
};

const stopForVisibilityChange = () => {
  if (document.visibilityState === "hidden" && isRecording()) {
    stopRecording({ interrupted: true, reason: "interrupted" });
  }
};

const getTimerClass = () => {
  if (coach.duration >= 90) return "speech-timer speech-timer--red";
  if (coach.duration >= 60) return "speech-timer speech-timer--amber";
  return "speech-timer";
};

const getSessionRows = () => {
  let rows = [...coach.sessions];
  if (coach.historyJobOnly && coach.selectedJobId) rows = rows.filter((session) => session.jobId === coach.selectedJobId);
  if (coach.historyCategory) rows = rows.filter((session) => session.category === coach.historyCategory);
  return rows.slice(0, 50);
};

const renderCapabilityWarnings = () => {
  const warnings = [];
  if (!supportsSpeechRecognition()) warnings.push("Live feedback unavailable on this browser. Android Chrome supports the Web Speech API.");
  if (!supportsMediaRecorder()) warnings.push("Audio capture unavailable. Use Android Chrome with mic permission enabled.");
  if (!navigator.onLine) warnings.push("Offline mode: sessions can be queued and synced later.");
  if (coach.warning) warnings.push(coach.warning);
  return warnings.length ? `<div class="speech-alert">${warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : "";
};

const renderJobContext = () => {
  const selectedJob = getSelectedJob();
  const options = [`<option value="">General drill</option>`]
    .concat(
      state.jobs.slice(0, 250).map((job) => {
        const selected = job.id === coach.selectedJobId ? "selected" : "";
        return `<option value="${escapeHtml(job.id)}" ${selected}>${escapeHtml(getJobLabel(job))}</option>`;
      })
    )
    .join("");
  const stats = selectedJob?.practiceStats;
  return `
    <div class="speech-panel speech-context-panel">
      <div>
        <h2>Speech Coach</h2>
        <p>Real-time filler detection for interview answers. Target: under 4 fillers/minute.</p>
      </div>
      <label class="speech-field">
        <span>Linked job</span>
        <select id="speech-job-select">${options}</select>
      </label>
      <div class="speech-context-summary">
        <strong>${escapeHtml(selectedJob ? getJobLabel(selectedJob) : "General practice")}</strong>
        <span>${stats?.sessionCount ? `${stats.sessionCount} sessions · avg ${Math.round(stats.avgScore || 0)} · ${Number(stats.avgFpm || 0).toFixed(1)} fpm` : "No sessions for this target yet."}</span>
      </div>
    </div>
  `;
};

const renderFilters = () => `
  <div class="speech-panel speech-filter-panel">
    <div class="speech-filter-row">
      ${CATEGORIES.map((category) => {
        const active = coach.activeCategories.has(category) ? "speech-chip--active" : "";
        return `<button class="speech-chip ${active}" data-speech-category="${category}">${escapeHtml(toTitle(category))}</button>`;
      }).join("")}
    </div>
    <label class="speech-field speech-field--inline">
      <span>Company filter</span>
      <input id="speech-company-filter" type="text" value="${escapeHtml(coach.companyFilter)}" placeholder="Wise, JPM, Barclays…" />
    </label>
  </div>
`;

const renderQuestionCard = () => {
  const question = coach.currentQuestion;
  return `
    <div class="speech-question-card">
      <div class="speech-question-meta">
        <span class="speech-category-badge">${escapeHtml(question ? toTitle(question.category) : "Question")}</span>
        <span>${coach.questions.length || 0} questions loaded</span>
      </div>
      <div class="speech-question-text">${escapeHtml(question?.text || "Load or select a question to begin.")}</div>
      <div class="speech-question-actions">
        <button id="speech-new-question" class="btn btn-secondary" ${coach.questions.length ? "" : "disabled"}>New question</button>
        <button id="speech-read-question" class="btn btn-tertiary" ${question && supportsTts() && !isBusy() ? "" : "disabled"}>Read only</button>
      </div>
    </div>
  `;
};

const renderControls = () => {
  const canStart = Boolean(coach.currentQuestion) && !isBusy();
  const stopDisabled = isRecording() ? "" : "disabled";
  return `
    <div class="speech-controls">
      <button id="speech-read-start" class="btn btn-primary" ${canStart ? "" : "disabled"}>${coach.status === "reading" ? "Reading…" : "Read & start"}</button>
      <button id="speech-start-now" class="btn btn-secondary" ${canStart ? "" : "disabled"}>Start without read</button>
      <button id="speech-stop" class="btn btn-secondary speech-stop" ${stopDisabled}>Stop</button>
      <label class="speech-toggle">
        <input id="speech-beep-toggle" type="checkbox" ${coach.beepEnabled ? "checked" : ""} />
        <span>Beep on filler</span>
      </label>
      ${coach.installPrompt ? `<button id="speech-install" class="btn btn-tertiary">Install PWA</button>` : ""}
    </div>
  `;
};

const renderLiveStats = () => {
  const minutes = Math.max(coach.duration / 60, 1 / 60);
  const liveFpm = coach.totalFillers / minutes;
  const flashClass = Date.now() < coach.flashUntil ? "speech-total--flash" : "";
  return `
    <div class="speech-live-grid">
      <div class="${getTimerClass()}">${formatDuration(coach.duration)}</div>
      <div class="speech-total ${flashClass}">
        <span>Total fillers</span>
        <strong>${coach.totalFillers}</strong>
      </div>
      <div class="speech-total">
        <span>Live fpm</span>
        <strong>${Number(liveFpm || 0).toFixed(1)}</strong>
      </div>
    </div>
  `;
};

const renderFillerGrid = () => `
  <div class="speech-filler-grid">
    ${FILLER_KEYS.map((key) => {
      const count = Number(coach.fillerCounts[key] || 0);
      const active = coach.lastIncremented === key && Date.now() < coach.flashUntil ? "speech-filler-pill--flash" : "";
      return `<div class="speech-filler-pill ${active}"><span>${escapeHtml(key)}</span><strong>${count}</strong></div>`;
    }).join("")}
  </div>
`;

const renderResult = () => {
  const session = coach.lastSession;
  if (!session) return "";
  const band = getScoreBand(session.score);
  const top = session.topFiller ? `${session.topFiller} (${session.fillerCounts?.[session.topFiller] || 0})` : "None";
  return `
    <div class="speech-result speech-result--${band}">
      <div class="speech-result-score">${session.score}</div>
      <div>
        <h3>Last session</h3>
        <p>${escapeHtml(session.questionText || "Question")}</p>
        <div class="speech-result-meta">
          <span>${session.totalFillers} fillers</span>
          <span>${session.fpm} fpm</span>
          <span>${formatDuration(session.duration)}</span>
          <span>${session.wpm} wpm</span>
          <span>Top: ${escapeHtml(top)}</span>
        </div>
        ${coach.audioUrl ? `<audio class="speech-audio" controls src="${coach.audioUrl}"></audio>` : ""}
        ${session.queuedOffline ? `<div class="speech-small-warning">Queued offline. It will sync automatically.</div>` : ""}
      </div>
    </div>
  `;
};

const renderHistory = () => {
  const rows = getSessionRows();
  const selectedJob = getSelectedJob();
  return `
    <div class="speech-panel speech-history-panel">
      <div class="speech-history-head">
        <div>
          <h3>History</h3>
          <p>Last 50 sessions. Tap a row for transcript and audio.</p>
        </div>
        <div class="speech-history-filters">
          <select id="speech-history-category">
            <option value="">All categories</option>
            ${CATEGORIES.map((category) => `<option value="${category}" ${coach.historyCategory === category ? "selected" : ""}>${escapeHtml(toTitle(category))}</option>`).join("")}
          </select>
          <label><input id="speech-history-job-only" type="checkbox" ${coach.historyJobOnly ? "checked" : ""} ${selectedJob ? "" : "disabled"} /> This job only</label>
          <button id="speech-retry-queue" class="btn btn-tertiary">Retry queued</button>
        </div>
      </div>
      <div class="speech-history-list">
        ${rows.length ? rows.map(renderHistoryRow).join("") : `<div class="speech-empty">No speech sessions yet.</div>`}
      </div>
    </div>
  `;
};

const renderHistoryRow = (session) => {
  const expanded = coach.expandedSessionId === session.id;
  const job = getSessionJob(session);
  const band = getScoreBand(session.score);
  const audioSrc = coach.audioUrls[session.id] || "";
  return `
    <div class="speech-history-row ${expanded ? "speech-history-row--expanded" : ""}" data-session-id="${escapeHtml(session.id)}">
      <button class="speech-history-main" data-expand-session="${escapeHtml(session.id)}">
        <span>${escapeHtml(formatSessionDate(session))}</span>
        <strong>${escapeHtml(toTitle(session.category))}</strong>
        <span>${escapeHtml(truncate(session.questionText || "Question", 64))}</span>
        <span class="speech-score-pill speech-score-pill--${band}">${Number(session.score || 0)}</span>
        <span>${Number(session.fpm || 0).toFixed(1)} fpm</span>
      </button>
      ${expanded ? `
        <div class="speech-history-detail">
          <div class="speech-history-meta">${escapeHtml(job ? getJobLabel(job) : "General drill")} · ${escapeHtml(session.source || "Speech Coach")}</div>
          <div class="speech-stored-transcript">${renderStoredTranscript(session)}</div>
          ${session.audioRef ? `<button class="btn btn-tertiary speech-load-audio" data-audio-session="${escapeHtml(session.id)}" data-audio-ref="${escapeHtml(session.audioRef)}">Load audio</button>` : ""}
          ${audioSrc ? `<audio class="speech-audio" controls src="${escapeHtml(audioSrc)}"></audio>` : ""}
        </div>
      ` : ""}
    </div>
  `;
};

const renderSpeechCoach = () => {
  if (!coach.container) return;
  const statusText = coach.info || (coach.questionsLoading ? "Loading questions…" : "Ready.");
  coach.container.innerHTML = `
    <section class="speech-coach">
      ${renderCapabilityWarnings()}
      ${renderJobContext()}
      ${renderFilters()}
      <div class="speech-main-grid">
        <div class="speech-left">
          ${renderQuestionCard()}
          ${renderControls()}
          <div class="speech-status-line">${escapeHtml(statusText)}</div>
          ${renderLiveStats()}
          ${renderFillerGrid()}
          ${renderResult()}
        </div>
        <div class="speech-right">
          <div class="speech-transcript-card">
            <div class="speech-transcript-head">
              <h3>Live transcript</h3>
              <span>${supportsSpeechRecognition() ? "Web Speech live" : "Live unsupported"}</span>
            </div>
            <div class="speech-transcript-body">${renderTranscriptHtml()}</div>
          </div>
        </div>
      </div>
      ${renderHistory()}
    </section>
  `;
  bindSpeechCoachEvents();
  if (isRecording()) {
    const transcriptBody = coach.container.querySelector(".speech-transcript-body");
    if (transcriptBody) transcriptBody.scrollTop = transcriptBody.scrollHeight;
  }
};

const bindSpeechCoachEvents = () => {
  const root = coach.container;
  root.querySelector("#speech-job-select")?.addEventListener("change", (event) => {
    coach.selectedJobId = event.target.value || null;
    const job = getSelectedJob();
    coach.companyFilter = job?.company || "";
    coach.asked = new Set();
    pickNextQuestion({ silent: true });
    loadSessions();
  });
  root.querySelectorAll("[data-speech-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.speechCategory;
      if (coach.activeCategories.has(category) && coach.activeCategories.size > 1) coach.activeCategories.delete(category);
      else coach.activeCategories.add(category);
      coach.asked = new Set();
      pickNextQuestion({ silent: true });
    });
  });
  root.querySelector("#speech-company-filter")?.addEventListener("change", (event) => {
    coach.companyFilter = event.target.value.trim();
    coach.asked = new Set();
    pickNextQuestion({ silent: true });
  });
  root.querySelector("#speech-new-question")?.addEventListener("click", () => pickNextQuestion());
  root.querySelector("#speech-read-question")?.addEventListener("click", () => readQuestion());
  root.querySelector("#speech-read-start")?.addEventListener("click", () => beginSession({ readFirst: true }));
  root.querySelector("#speech-start-now")?.addEventListener("click", () => beginSession({ readFirst: false }));
  root.querySelector("#speech-stop")?.addEventListener("click", () => stopRecording({ interrupted: false }));
  root.querySelector("#speech-beep-toggle")?.addEventListener("change", (event) => {
    coach.beepEnabled = event.target.checked;
    safeLocalStorageSet("speechCoach.beepEnabled", String(coach.beepEnabled));
  });
  root.querySelector("#speech-install")?.addEventListener("click", async () => {
    if (!coach.installPrompt) return;
    coach.installPrompt.prompt();
    await coach.installPrompt.userChoice.catch(() => null);
    coach.installPrompt = null;
    renderSpeechCoach();
  });
  root.querySelector("#speech-history-category")?.addEventListener("change", (event) => {
    coach.historyCategory = event.target.value;
    renderSpeechCoach();
  });
  root.querySelector("#speech-history-job-only")?.addEventListener("change", (event) => {
    coach.historyJobOnly = event.target.checked;
    renderSpeechCoach();
  });
  root.querySelector("#speech-retry-queue")?.addEventListener("click", () => retryQueuedSessions({ visible: true }));
  root.querySelectorAll("[data-expand-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.expandSession;
      coach.expandedSessionId = coach.expandedSessionId === id ? "" : id;
      renderSpeechCoach();
    });
  });
  root.querySelectorAll(".speech-load-audio").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = button.dataset.audioSession;
      const audioRef = button.dataset.audioRef;
      try {
        const query = buildQuery({ audioRef });
        const data = await fetchJson(`/.netlify/functions/speech-audio-url?${query}`);
        if (data.url) coach.audioUrls[sessionId] = data.url;
        renderSpeechCoach();
      } catch (error) {
        console.error(error);
        showToast("Audio could not be loaded.");
      }
    });
  });
};

export const openSpeechCoachForJob = (jobId) => {
  coach.selectedJobId = jobId || null;
  const job = getSelectedJob();
  coach.companyFilter = job?.company || "";
  coach.historyJobOnly = Boolean(jobId);
  coach.asked = new Set();
  if (state.handlers.setActiveTab) state.handlers.setActiveTab("speechcoach");
  loadQuestions().then(() => pickNextQuestion({ silent: true }));
  loadSessions();
  renderSpeechCoach();
};

export const renderJobPracticeStats = (job) => {
  const stats = job?.practiceStats || job?.practice_stats || null;
  if (!stats || !Number(stats.sessionCount || 0)) {
    return `
      <div class="speech-job-practice-empty">
        <strong>No practice sessions yet.</strong>
        <span>Use Speech Coach to tag answers to this role and track whether this target is improving.</span>
      </div>
    `;
  }
  const trend = stats.trendDirection || stats.trend?.direction || "flat";
  const delta = stats.trendDelta ?? stats.trend?.delta ?? 0;
  const trendLabel = trend === "improving" ? `Improving by ${Number(delta || 0).toFixed(1)} fpm` : trend === "worsening" ? `Worsening by ${Math.abs(Number(delta || 0)).toFixed(1)} fpm` : "Flat trend";
  const recentSessions = Array.isArray(stats.recentSessions) ? stats.recentSessions.slice(0, 5) : [];
  return `
    <div class="speech-job-practice-stats">
      <div><strong>${Number(stats.sessionCount || 0)}</strong><span>sessions</span></div>
      <div><strong>${Math.round(Number(stats.avgScore || 0))}</strong><span>avg score</span></div>
      <div><strong>${Number(stats.avgFpm || 0).toFixed(1)}</strong><span>avg fpm</span></div>
      <div><strong>${Math.round(Number(stats.bestScore || 0))}</strong><span>best</span></div>
    </div>
    <div class="speech-job-practice-trend">${escapeHtml(trendLabel)}</div>
    ${
      recentSessions.length
        ? `<div class="speech-job-recent">
            ${recentSessions
              .map(
                (session) =>
                  `<div><span>${escapeHtml(formatSessionDate(session))}</span><strong>${Math.round(Number(session.score || 0))}</strong><span>${Number(session.fpm || 0).toFixed(1)} fpm</span><em>${escapeHtml(truncate(session.questionText || "Question", 60))}</em></div>`
              )
              .join("")}
          </div>`
        : ""
    }
  `;
};

const initSpeechCoach = () => {
  if (coach.initialized) return;
  coach.container = document.getElementById("speechcoach-content");
  if (!coach.container) return;
  coach.initialized = true;
  renderSpeechCoach();
  loadQuestions();
  loadSessions();
  retryQueuedSessions();
  document.addEventListener("visibilitychange", stopForVisibilityChange);
  window.addEventListener("online", () => retryQueuedSessions());
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    coach.installPrompt = event;
    renderSpeechCoach();
  });
};

initSpeechCoach();
