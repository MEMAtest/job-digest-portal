export const FILLER_DEFINITIONS = [
  { key: "kind of", pattern: /\bkind\s+of\b/gi },
  { key: "obviously", pattern: /\bobviously\b/gi },
  { key: "I think", pattern: /\bi\s+(?:kind\s+of\s+|sort\s+of\s+)?think\b/gi },
  { key: "probably", pattern: /\bprobably\b/gi },
  { key: "maybe", pattern: /\bmaybe\b/gi },
  { key: "you know", pattern: /\byou\s+know\b/gi },
  { key: "sort of", pattern: /\bsort\s+of\b/gi },
  { key: "I guess", pattern: /\bi\s+guess\b/gi },
  { key: "essentially", pattern: /\bessentially\b/gi },
  { key: "to be honest", pattern: /\bto\s+be\s+honest\b/gi },
  { key: "I'd say", pattern: /\bi['’]?d\s+say\b/gi },
];

export const FILLER_KEYS = [...FILLER_DEFINITIONS.map((item) => item.key), "like"];

const emptyCounts = () => Object.fromEntries(FILLER_KEYS.map((key) => [key, 0]));

const countWords = (text) => {
  const matches = String(text || "").trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g);
  return matches ? matches.length : 0;
};

const pushMatch = (matches, filler, start, end, text) => {
  if (start < 0 || end <= start) return;
  matches.push({ filler, start, end, text: text.slice(start, end) });
};

const detectLikeMatches = (text) => {
  const matches = [];
  const patterns = [
    /\b(?:i|he|she|it|we|they|you)\s+(?:was|were|am|are)\s+like\b/gi,
    /\bit['’]?s\s+like\b/gi,
    /(?:^|[.!?,;:]\s+|\band\s+|\bso\s+)like\b(?=\s*(?:,|\b(?:i|you)\b|[.!?]|$))/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const matched = match[0] || "";
      const localIndex = matched.toLowerCase().lastIndexOf("like");
      if (localIndex < 0) continue;
      const start = (match.index || 0) + localIndex;
      pushMatch(matches, "like", start, start + 4, text);
    }
  }
  return matches;
};

const dedupeMatches = (matches) => {
  const seen = new Set();
  return matches
    .filter((match) => {
      const key = `${match.filler}:${match.start}:${match.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
};

export const detectFillers = (text, options = {}) => {
  const source = String(text || "");
  const counts = emptyCounts();
  let matches = [];

  for (const definition of FILLER_DEFINITIONS) {
    definition.pattern.lastIndex = 0;
    for (const match of source.matchAll(definition.pattern)) {
      pushMatch(matches, definition.key, match.index || 0, (match.index || 0) + match[0].length, source);
    }
  }

  if (options.detectLike !== false) {
    matches = matches.concat(detectLikeMatches(source));
  }

  const deduped = dedupeMatches(matches);
  for (const match of deduped) counts[match.filler] += 1;
  return { counts, matches: deduped, total: deduped.length };
};

export const mergeFillerCounts = (base = emptyCounts(), extra = emptyCounts()) => {
  const merged = emptyCounts();
  for (const key of FILLER_KEYS) merged[key] = Number(base[key] || 0) + Number(extra[key] || 0);
  return merged;
};

export const calculateSpeechScore = ({ duration = 0, totalFillers = 0, transcript = "" } = {}) => {
  const durationSeconds = Math.max(0, Number(duration) || 0);
  const minutes = Math.max(durationSeconds / 60, 1 / 60);
  const words = countWords(transcript);
  const fpm = totalFillers / minutes;
  const wpm = words / minutes;
  let score = 100;
  score -= Math.max(0, fpm - 2) * 8;
  if (durationSeconds > 100) score -= 5;
  if (durationSeconds < 30) score -= 8;
  if (wpm < 100) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    fpm: Number(fpm.toFixed(2)),
    wpm: Number(wpm.toFixed(0)),
    words,
    duration: durationSeconds,
  };
};

export const getScoreBand = (score) => {
  const numeric = Number(score) || 0;
  if (numeric >= 75) return "green";
  if (numeric >= 50) return "amber";
  return "red";
};

export const getTopFiller = (counts = {}) => {
  let top = null;
  for (const key of FILLER_KEYS) {
    const value = Number(counts[key] || 0);
    if (value <= 0) continue;
    if (!top || value > top.count) top = { filler: key, count: value };
  }
  return top;
};

export const selectQuestion = (questions = [], options = {}) => {
  const categories = new Set(options.categories || []);
  const company = String(options.company || "").trim().toLowerCase();
  let asked = options.asked instanceof Set ? options.asked : new Set(options.asked || []);
  let pool = questions.filter((question) => {
    if (categories.size && !categories.has(question.category)) return false;
    if (company) {
      const tags = (question.companyTag || []).map((tag) => String(tag).toLowerCase());
      if (tags.length && !tags.includes(company)) return false;
    }
    return true;
  });
  if (!pool.length) return { question: null, asked, reset: false };
  let available = pool.filter((question) => !asked.has(question.id));
  let reset = false;
  if (!available.length) {
    asked = new Set();
    available = [...pool];
    reset = true;
  }
  const random = typeof options.random === "function" ? options.random : Math.random;
  const index = Math.floor(random() * available.length);
  const question = available[index];
  asked.add(question.id);
  return { question, asked, reset };
};

export const calculateTrend = (sessions = []) => {
  if (!Array.isArray(sessions) || sessions.length < 5) return null;
  const sorted = [...sessions].sort((a, b) => new Date(b.createdAtIso || b.createdAt || 0) - new Date(a.createdAtIso || a.createdAt || 0));
  const last = sorted.length >= 10 ? sorted.slice(0, 5) : sorted.slice(0, Math.ceil(sorted.length / 2));
  const prior = sorted.length >= 10 ? sorted.slice(5, 10) : sorted.slice(Math.ceil(sorted.length / 2));
  if (!prior.length) return null;
  const avg = (items) => items.reduce((sum, item) => sum + Number(item.fpm || 0), 0) / items.length;
  const lastAvg = avg(last);
  const priorAvg = avg(prior);
  const delta = Number((priorAvg - lastAvg).toFixed(1));
  const direction = Math.abs(delta) < 0.2 ? "flat" : delta > 0 ? "improving" : "worsening";
  return { direction, delta, lastAvg: Number(lastAvg.toFixed(1)), priorAvg: Number(priorAvg.toFixed(1)) };
};

export const buildSessionPayload = ({
  sessionId,
  jobId = null,
  question,
  transcript,
  duration,
  fillerCounts,
  audioRef = null,
  device = "",
  interrupted = false,
  webSpeechTranscript = "",
} = {}) => {
  const totalFillers = Object.values(fillerCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const scoreData = calculateSpeechScore({ duration, totalFillers, transcript });
  const top = getTopFiller(fillerCounts);
  const now = new Date().toISOString();
  return {
    id: sessionId,
    sessionId,
    jobId: jobId || null,
    questionId: question?.id || "",
    questionText: question?.text || "",
    category: question?.category || "",
    transcript: transcript || "",
    webSpeechTranscript: webSpeechTranscript || transcript || "",
    duration: scoreData.duration,
    fillerCounts: { ...emptyCounts(), ...(fillerCounts || {}) },
    totalFillers,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    score: scoreData.score,
    topFiller: top?.filler || null,
    audioRef: audioRef || null,
    createdAtIso: now,
    device,
    interrupted: Boolean(interrupted),
    queuedOffline: false,
  };
};

export const rescoreSessionWithTranscript = (session = {}, transcript = "", options = {}) => {
  const canonicalTranscript = String(transcript || "").trim();
  if (!session?.id || !canonicalTranscript) return session;

  const detected = detectFillers(canonicalTranscript);
  const scoreData = calculateSpeechScore({
    duration: session.duration,
    totalFillers: detected.total,
    transcript: canonicalTranscript,
  });
  const top = getTopFiller(detected.counts);

  return {
    ...session,
    transcript: canonicalTranscript,
    whisperTranscript: canonicalTranscript,
    whisperModel: options.model || "onnx-community/whisper-tiny.en",
    transcriptionSource: "whisper",
    rescored: true,
    rescoredAt: new Date().toISOString(),
    fillerCounts: detected.counts,
    totalFillers: detected.total,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    score: scoreData.score,
    topFiller: top?.filler || null,
  };
};
