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

const sentenceCount = (text) => {
  const matches = String(text || "").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  return matches.length;
};

const firstSentence = (text) => String(text || "").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean)[0] || "";

const normaliseTokens = (text) => {
  const stopwords = new Set([
    "the", "and", "for", "that", "this", "with", "from", "into", "then", "than", "your", "you", "are", "was",
    "were", "have", "has", "had", "but", "not", "can", "would", "should", "could", "about", "answer", "question",
    "using", "use", "role", "work", "worked", "working", "product", "point", "show", "shows", "clear",
  ]);
  const tokens = String(text || "").toLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)?/g) || [];
  return tokens
    .map((token) => token.replace(/['’]s$/, ""))
    .filter((token) => token.length > 2 && !stopwords.has(token));
};

const topKeywords = (text, limit = 12) => {
  const counts = new Map();
  normaliseTokens(text).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([token]) => token);
};

const keywordHits = (transcript, keywords) => {
  const tokens = new Set(normaliseTokens(transcript));
  return keywords.filter((keyword) => tokens.has(keyword));
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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

export const calculateSpeechPatterns = (sessions = []) => {
  if (!Array.isArray(sessions) || sessions.length < 3) return [];
  const sorted = [...sessions]
    .filter((session) => session && !session.smokeTest)
    .sort((a, b) => new Date(b.createdAtIso || b.createdAt || 0) - new Date(a.createdAtIso || a.createdAt || 0))
    .slice(0, 10);
  if (sorted.length < 3) return [];

  const count = (predicate) => sorted.filter(predicate).length;
  const avg = (selector) => sorted.reduce((sum, item) => sum + Number(selector(item) || 0), 0) / sorted.length;
  const patterns = [];
  const metricLateOrAbsent = count((session) => {
    const placement = session.aiReview?.metricPlacement;
    const deterministicMetric = session.speechReview?.metrics?.hasMetric;
    return placement ? placement !== "first_15s" : !deterministicMetric;
  });
  const weakClose = count((session) => {
    const aiClose = session.aiReview?.structure?.close;
    const deterministicClose = session.speechReview?.metrics?.hasClose;
    return aiClose === false || deterministicClose === false;
  });
  const highFiller = count((session) => Number(session.fpm || 0) > 4);
  const fallbackReviews = count((session) => session.aiReview?.status === "fallback");
  const missingEvidence = count((session) => session.speechReview?.metrics?.hasEvidence === false);
  const avgFpm = avg((session) => session.fpm);
  const avgScore = avg((session) => session.score);

  if (metricLateOrAbsent >= Math.ceil(sorted.length * 0.5)) {
    patterns.push({
      severity: "amber",
      title: "Metric arrives too late",
      detail: `${metricLateOrAbsent}/${sorted.length} recent answers did not land a metric in the opening. Put the number in sentence one.`,
    });
  }
  if (weakClose >= Math.ceil(sorted.length * 0.5)) {
    patterns.push({
      severity: "amber",
      title: "Close is not landing",
      detail: `${weakClose}/${sorted.length} recent answers did not clearly close with why the example matters for the role.`,
    });
  }
  if (highFiller >= Math.ceil(sorted.length * 0.4)) {
    patterns.push({
      severity: "red",
      title: "Filler rate above target",
      detail: `${highFiller}/${sorted.length} recent answers were above 4.0 fillers/min. Current recent average is ${avgFpm.toFixed(1)} fpm.`,
    });
  }
  if (missingEvidence >= Math.ceil(sorted.length * 0.5)) {
    patterns.push({
      severity: "amber",
      title: "Named evidence missing",
      detail: `${missingEvidence}/${sorted.length} recent answers did not name a concrete example such as Ebury, Vistra, N26, Elucidate, Fenergo or Napier.`,
    });
  }
  if (fallbackReviews >= Math.ceil(sorted.length * 0.5)) {
    patterns.push({
      severity: "amber",
      title: "AI provider fallback",
      detail: `${fallbackReviews}/${sorted.length} recent reviews used the local fallback. Check OpenRouter provider health if this persists.`,
    });
  }
  if (!patterns.length) {
    patterns.push({
      severity: avgScore >= 75 && avgFpm <= 4 ? "green" : "amber",
      title: avgScore >= 75 && avgFpm <= 4 ? "Recent pattern is healthy" : "No dominant pattern yet",
      detail:
        avgScore >= 75 && avgFpm <= 4
          ? `Last ${sorted.length} sessions average ${Math.round(avgScore)} with ${avgFpm.toFixed(1)} fpm. Keep repeating against target roles.`
          : `Last ${sorted.length} sessions average ${Math.round(avgScore)} with ${avgFpm.toFixed(1)} fpm. Keep collecting samples.`,
    });
  }

  return patterns.slice(0, 4);
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
  const speechReview = reviewSpeechAnswer({
    transcript,
    modelAnswer: question?.modelAnswer || "",
    duration: scoreData.duration,
    fillerCounts,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    category: question?.category || "",
  });
  return {
    id: sessionId,
    sessionId,
    jobId: jobId || null,
    questionId: question?.id || "",
    questionText: question?.text || "",
    questionModelAnswer: question?.modelAnswer || "",
    category: question?.category || "",
    transcript: transcript || "",
    webSpeechTranscript: webSpeechTranscript || transcript || "",
    duration: scoreData.duration,
    fillerCounts: { ...emptyCounts(), ...(fillerCounts || {}) },
    totalFillers,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    baseScore: scoreData.score,
    score: scoreData.score,
    phase3Score: null,
    scoreType: "filler_score",
    topFiller: top?.filler || null,
    speechReview,
    aiReview: null,
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
  const speechReview = reviewSpeechAnswer({
    transcript: canonicalTranscript,
    modelAnswer: options.modelAnswer || session.questionModelAnswer || "",
    duration: scoreData.duration,
    fillerCounts: detected.counts,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    category: session.category || "",
  });

  return {
    ...session,
    transcript: canonicalTranscript,
    whisperTranscript: canonicalTranscript,
    whisperModel: options.model || "Xenova/whisper-tiny.en",
    transcriptionSource: "whisper",
    rescored: true,
    rescoredAt: new Date().toISOString(),
    fillerCounts: detected.counts,
    totalFillers: detected.total,
    fpm: scoreData.fpm,
    wpm: scoreData.wpm,
    baseScore: scoreData.score,
    score: scoreData.score,
    phase3Score: null,
    scoreType: "filler_score",
    topFiller: top?.filler || null,
    speechReview,
    aiReview: null,
  };
};

export const reviewSpeechAnswer = ({
  transcript = "",
  modelAnswer = "",
  duration = 0,
  fillerCounts = {},
  fpm = 0,
  wpm = 0,
  category = "",
} = {}) => {
  const text = String(transcript || "").trim();
  const words = countWords(text);
  const sentences = sentenceCount(text);
  const opening = firstSentence(text);
  const lower = text.toLowerCase();
  const modelKeywords = topKeywords(modelAnswer, 12);
  const hits = keywordHits(text, modelKeywords);
  const missingKeywords = modelKeywords.filter((keyword) => !hits.includes(keyword)).slice(0, 6);
  const totalFillers = Object.values(fillerCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const metrics = text.match(/\b\d+%|\b\d+\s*(days?|weeks?|months?|records?|jurisdictions?|markets?|k|m|million|thousand|arr|gbp|£)/gi) || [];
  const hasMetric = metrics.length > 0;
  const hasEvidence = /\b(vistra|ebury|n26|elucidate|fenergo|napier|enate|lexisnexis|salesforce|30\+|50,?000|38%|55%|70%|120k|400k)\b/i.test(text);
  const hasStructure =
    /\b(situation|task|action|result|first|second|third|firstly|secondly|finally|so the result|the result|i would start|i would then|i would close)\b/i.test(text) ||
    sentences >= 3;
  const hasOpeningJudgement =
    opening.length > 20 &&
    !/^(um|uh|so|yeah|i guess|i think|maybe|probably|kind of|sort of)\b/i.test(opening) &&
    /\b(i would|i'd|my view|the key|the problem|the priority|i would start|i would frame)\b/i.test(opening);
  const hasClose = /\b(close|closing|result|therefore|so i would|that is why|the key point|what this shows|in short)\b/i.test(
    lower.slice(Math.max(0, lower.length - 260))
  );
  const lengthScore = words >= 90 && words <= 220 ? 100 : words >= 60 && words <= 260 ? 75 : words >= 35 ? 55 : 25;
  const fillerScore = clamp(100 - Math.max(0, Number(fpm || 0) - 2) * 18);
  const metricScore = hasMetric ? 100 : 35;
  const evidenceScore = hasEvidence ? 100 : 45;
  const structureScore = hasStructure ? 90 : sentences >= 2 ? 60 : 30;
  const openingScore = hasOpeningJudgement ? 90 : opening.length > 20 ? 60 : 30;
  const relevanceScore = modelKeywords.length ? Math.round((hits.length / modelKeywords.length) * 100) : 65;
  const closeScore = hasClose ? 85 : 45;
  const score = Math.round(
    lengthScore * 0.12 +
      fillerScore * 0.18 +
      metricScore * 0.14 +
      evidenceScore * 0.16 +
      structureScore * 0.16 +
      openingScore * 0.1 +
      relevanceScore * 0.1 +
      closeScore * 0.04
  );
  const verdict = score >= 80 ? "strong" : score >= 65 ? "good" : score >= 50 ? "needs work" : "weak";
  const strengths = [];
  if (hasMetric) strengths.push("Used a concrete metric.");
  if (hasEvidence) strengths.push("Anchored the answer in named experience.");
  if (hasStructure) strengths.push("Had enough structure to follow the answer.");
  if (Number(fpm || 0) <= 4) strengths.push("Filler rate stayed within the target zone.");
  if (hits.length >= Math.max(2, Math.ceil(modelKeywords.length * 0.35))) strengths.push("Covered several model-answer keywords.");
  if (!strengths.length) strengths.push("Captured a usable first draft to improve.");

  const fixes = [];
  if (!hasOpeningJudgement) fixes.push("Open with a direct judgement before explaining context.");
  if (!hasMetric) fixes.push("Add one quantified result or baseline.");
  if (!hasEvidence) fixes.push("Name the relevant experience: Vistra, Ebury, N26, Elucidate, Fenergo, Napier or Enate.");
  if (!hasStructure) fixes.push("Use a simple spine: situation, action, result, relevance.");
  if (Number(fpm || 0) > 4) fixes.push(`Reduce fillers from ${Number(fpm || 0).toFixed(1)} per minute to under 4.0.`);
  if (words < 60) fixes.push("Develop the answer beyond a short fragment.");
  if (words > 260) fixes.push("Cut the answer to a tighter 60-90 second version.");
  if (!hasClose) fixes.push("End with why the example matters for the role.");
  if (missingKeywords.length) fixes.push(`Work in missing ideas: ${missingKeywords.slice(0, 4).join(", ")}.`);

  const betterAnswer = buildBetterAnswer({ transcript: text, modelAnswer, category, missingKeywords, hasMetric, hasEvidence });
  const drill = fixes[0] || "Repeat the answer once, keeping the same structure and cutting one filler.";

  return {
    version: 1,
    score,
    verdict,
    createdAt: new Date().toISOString(),
    metrics: {
      words,
      sentences,
      fpm: Number(Number(fpm || 0).toFixed(2)),
      wpm: Number(wpm || 0),
      totalFillers,
      modelKeywordCoverage: modelKeywords.length ? Number((hits.length / modelKeywords.length).toFixed(2)) : null,
      matchedKeywords: hits,
      missingKeywords,
      hasMetric,
      hasEvidence,
      hasStructure,
      hasOpeningJudgement,
      hasClose,
    },
    strengths: strengths.slice(0, 4),
    fixes: fixes.slice(0, 5),
    betterAnswer,
    drill,
  };
};

const buildBetterAnswer = ({ transcript, modelAnswer, category, missingKeywords = [], hasMetric, hasEvidence }) => {
  const model = String(modelAnswer || "").trim();
  if (model) {
    const sentences = model.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
    if (sentences.length >= 3) return sentences.slice(0, 4).join(" ");
    return model;
  }
  const evidencePrompt = hasEvidence ? "the relevant delivery example" : "a named example such as Vistra, Ebury, N26 or Elucidate";
  const metricPrompt = hasMetric ? "the metric already mentioned" : "one concrete metric";
  const missing = missingKeywords.length ? ` I would explicitly include ${missingKeywords.slice(0, 3).join(", ")}.` : "";
  if (category === "behavioural") {
    return `I would frame this as a STAR answer. The situation was a regulated workflow where speed, control quality and stakeholder alignment were all under pressure. My action was to map the constraint, align Compliance, Operations and Engineering, and make the smallest safe process or platform change. The result should land with ${metricPrompt}, then close by explaining why ${evidencePrompt} is relevant to this role.${missing}`;
  }
  return `I would start with the judgement, then give the evidence. The key issue is the trade-off between customer or operational flow and control quality. I would use ${evidencePrompt}, explain the product decision, quantify the impact with ${metricPrompt}, and close with how the same judgement applies to this role.${missing}`;
};
