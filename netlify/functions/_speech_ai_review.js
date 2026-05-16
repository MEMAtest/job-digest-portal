const { buildTextProviders, generateTextWithProvider } = require("./_prep_ai");

const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_SPEECH_REVIEW_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_MODEL_ANSWER_CHARS = 5000;

const numberValue = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(numberValue(value, 0))));

const stringValue = (value, max = 1000) => String(value || "").trim().slice(0, max);

const cleanList = (items, maxItems = 5, maxChars = 240) =>
  Array.isArray(items)
    ? items
        .slice(0, maxItems)
        .map((item) => stringValue(item, maxChars))
        .filter(Boolean)
    : [];

const calculateFillerComponent = (fpm = 0) => clampScore(100 - Math.max(0, numberValue(fpm, 0) - 2) * 12);

const calculateDurationComponent = (duration = 0) => {
  const seconds = numberValue(duration, 0);
  if (seconds >= 60 && seconds <= 90) return 100;
  if (seconds >= 45 && seconds <= 105) return 82;
  if (seconds >= 30 && seconds <= 120) return 65;
  return 35;
};

const calculateCombinedScore = ({ clarityScore, structureScore, fpm, duration }) => {
  const fillerScore = calculateFillerComponent(fpm);
  const durationScore = calculateDurationComponent(duration);
  const combinedScore = clampScore(
    fillerScore * 0.5 +
      clampScore(clarityScore) * 0.25 +
      clampScore(structureScore) * 0.15 +
      durationScore * 0.1
  );
  return { combinedScore, fillerScore, durationScore };
};

const verdictForScore = (score) => {
  const numeric = numberValue(score, 0);
  if (numeric >= 82) return "strong";
  if (numeric >= 70) return "good";
  if (numeric >= 55) return "needs work";
  return "weak";
};

const safeJsonParse = (text) => {
  const source = String(text || "").trim();
  if (!source) throw new Error("Empty AI review response");
  try {
    return JSON.parse(source);
  } catch {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error("AI review response was not valid JSON");
  }
};

const normalizeMetricPlacement = (value) => {
  const normalized = stringValue(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (["first_15s", "first_15_seconds", "early"].includes(normalized)) return "first_15s";
  if (["later", "late"].includes(normalized)) return "later";
  return "absent";
};

const normalizeLengthVerdict = (value) => {
  const normalized = stringValue(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (["too_short", "short"].includes(normalized)) return "too_short";
  if (["too_long", "long"].includes(normalized)) return "too_long";
  return "tight";
};

const buildSpeechReviewPrompt = (session = {}) => {
  const transcript = stringValue(session.transcript || session.whisperTranscript || session.webSpeechTranscript, MAX_TRANSCRIPT_CHARS);
  const modelAnswer = stringValue(session.questionModelAnswer || "", MAX_MODEL_ANSWER_CHARS);
  const context = {
    question: stringValue(session.questionText, 1200),
    category: stringValue(session.category, 80),
    modelAnswer,
    transcript,
    metrics: {
      durationSeconds: numberValue(session.duration, 0),
      fillerRatePerMinute: numberValue(session.fpm, 0),
      wordsPerMinute: numberValue(session.wpm, 0),
      totalFillers: numberValue(session.totalFillers, 0),
      baseScore: numberValue(session.baseScore ?? session.score, 0),
      topFiller: stringValue(session.topFiller, 80),
    },
  };

  return `You are an interview speech coach for a senior fintech / financial-crime product candidate.

Score the answer against the question, the model answer, and the candidate's need to sound concise, specific, metric-led, and low-hedging.

Candidate evidence to reward when used well:
- Vistra: global KYC / CLM workflow standardisation across 30+ jurisdictions, onboarding cycle-time improvement.
- Ebury: screening threshold / LexisNexis API optimisation, 38% fewer unnecessary manual reviews.
- N26: EDD automation and financial-crime operating model improvements.
- Elucidate: zero-to-one bank proof of concept and commercial discovery.
- Fenergo, Napier, Enate, Salesforce: relevant platform, CLM, screening, workflow and migration delivery.

Return JSON only. Do not use markdown. Keep text concise.

Required JSON shape:
{
  "clarityScore": 0-100,
  "structureScore": 0-100,
  "confidenceScore": 0-100,
  "hedgingCount": number,
  "metricPlacement": "first_15s" | "later" | "absent",
  "structure": { "opening": boolean, "body": boolean, "close": boolean },
  "jargonFlags": ["specific unclear phrase"],
  "lengthVerdict": "too_short" | "tight" | "too_long",
  "diagnosis": "one direct sentence",
  "strengths": ["max 4"],
  "fixes": ["max 5"],
  "betterAnswer": "a tighter 90 second answer in the candidate's voice",
  "nextDrill": "one concrete drill for the next repetition"
}

Session:
${JSON.stringify(context, null, 2)}`;
};

const countWords = (text) => {
  const matches = String(text || "").trim().match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g);
  return matches ? matches.length : 0;
};

const countSentences = (text) => String(text || "").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean).length;

const buildFallbackRawReview = (session = {}, reason = "") => {
  const transcript = stringValue(session.transcript || session.whisperTranscript || session.webSpeechTranscript, MAX_TRANSCRIPT_CHARS);
  const lower = transcript.toLowerCase();
  const words = countWords(transcript);
  const sentences = countSentences(transcript);
  const hasMetric = /\b\d+%|\b\d+\s*(days?|weeks?|months?|records?|jurisdictions?|markets?|k|m|million|thousand|arr|gbp|£)/i.test(transcript);
  const hasEvidence = /\b(vistra|ebury|n26|elucidate|fenergo|napier|enate|lexisnexis|salesforce|30\+|50,?000|38%|55%|70%|120k|400k)\b/i.test(transcript);
  const hasOpening = /\b(i would|i'd|my view|the key|the priority|i would start|i would frame|i would use)\b/i.test(transcript.slice(0, 220));
  const hasClose = /\b(relevant|this shows|in short|therefore|so i would|the key point|for this role|why it matters)\b/i.test(lower.slice(-320));
  const hasStructure = sentences >= 3 || /\b(first|second|third|then|finally|result|because|therefore)\b/i.test(transcript);
  const hedgingMatches = lower.match(/\b(i think|probably|maybe|i guess|kind of|sort of|to be honest|i'd say)\b/g) || [];
  const fpm = numberValue(session.fpm, 0);

  const clarityScore = clampScore(
    45 +
      (words >= 70 && words <= 220 ? 16 : words >= 45 ? 8 : -8) +
      (hasMetric ? 14 : -8) +
      (hasEvidence ? 14 : -6) +
      (fpm <= 4 ? 8 : -8) +
      (hasClose ? 5 : 0)
  );
  const structureScore = clampScore(
    40 +
      (hasOpening ? 20 : -5) +
      (hasStructure ? 22 : -8) +
      (hasClose ? 13 : -5) +
      (sentences >= 3 ? 5 : 0)
  );
  const confidenceScore = clampScore(86 - hedgingMatches.length * 8 - Math.max(0, fpm - 2) * 5);

  const strengths = [];
  if (hasOpening) strengths.push("Opened with a clear direction.");
  if (hasMetric) strengths.push("Used a concrete metric.");
  if (hasEvidence) strengths.push("Anchored the answer in named experience.");
  if (hasStructure) strengths.push("The answer had a followable structure.");
  if (!strengths.length) strengths.push("Captured enough transcript to coach from.");

  const fixes = [];
  if (!hasOpening) fixes.push("Open with the decision or judgement before context.");
  if (!hasMetric) fixes.push("Put one metric in the first 15 seconds.");
  if (!hasEvidence) fixes.push("Name the relevant evidence: Ebury, Vistra, N26, Elucidate, Fenergo, Napier or Enate.");
  if (!hasStructure) fixes.push("Use a simple spine: judgement, evidence, result, relevance.");
  if (!hasClose) fixes.push("Close by saying why the example matters for the target role.");
  if (hedgingMatches.length) fixes.push(`Remove hedging: ${Array.from(new Set(hedgingMatches)).slice(0, 3).join(", ")}.`);
  if (reason) fixes.push("External LLM review was unavailable, so this used the local Phase 3 fallback.");

  const modelAnswer = stringValue(session.questionModelAnswer || "", 1800);
  return {
    clarityScore,
    structureScore,
    confidenceScore,
    hedgingCount: hedgingMatches.length,
    metricPlacement: hasMetric ? (/\b\d+%|\b\d+\s*(days?|weeks?|months?|records?|jurisdictions?|markets?|k|m|million|thousand|arr|gbp|£)/i.test(transcript.slice(0, 220)) ? "first_15s" : "later") : "absent",
    structure: { opening: hasOpening, body: hasStructure, close: hasClose },
    jargonFlags: [],
    lengthVerdict: words < 70 ? "too_short" : words > 230 ? "too_long" : "tight",
    diagnosis: hasMetric && hasEvidence
      ? "Specific and evidence-led; tighten the opening and close if either is missing."
      : "The answer needs earlier proof: lead with a metric and named delivery example.",
    strengths,
    fixes,
    betterAnswer: modelAnswer || "I would open with the judgement, anchor it in a named example, give one metric, and close by explaining why that evidence matters for this role.",
    nextDrill: fixes[0] || "Repeat once with the metric in sentence one and no hedging.",
  };
};

const buildFallbackReview = ({ session = {}, reason = "", providerConfigured = false } = {}) => {
  const rawReview = buildFallbackRawReview(session, reason);
  const review = normalizeAiReview({
    rawReview,
    session,
    provider: { name: "local-fallback", model: "deterministic-phase3-v1" },
  });
  return {
    ...review,
    status: "fallback",
    fallbackReason: stringValue(reason, 500),
    providerConfigured: Boolean(providerConfigured),
  };
};

const normalizeAiReview = ({ rawReview = {}, session = {}, provider = {} }) => {
  const clarityScore = clampScore(rawReview.clarityScore);
  const structureScore = clampScore(rawReview.structureScore);
  const confidenceScore = clampScore(rawReview.confidenceScore);
  const { combinedScore, fillerScore, durationScore } = calculateCombinedScore({
    clarityScore,
    structureScore,
    fpm: session.fpm,
    duration: session.duration,
  });
  const structure = rawReview.structure && typeof rawReview.structure === "object" ? rawReview.structure : {};
  const transcript = stringValue(session.transcript || session.whisperTranscript || session.webSpeechTranscript, MAX_TRANSCRIPT_CHARS);

  return {
    version: 1,
    status: "complete",
    provider: stringValue(provider.name || "unknown", 80),
    model: stringValue(provider.model || "", 160),
    createdAt: new Date().toISOString(),
    transcriptHash: stringValue(session.transcriptHash || "", 120),
    score: combinedScore,
    combinedScore,
    verdict: verdictForScore(combinedScore),
    components: {
      fillerScore,
      clarityScore,
      structureScore,
      durationScore,
      confidenceScore,
    },
    metrics: {
      duration: numberValue(session.duration, 0),
      fpm: numberValue(session.fpm, 0),
      wpm: numberValue(session.wpm, 0),
      totalFillers: numberValue(session.totalFillers, 0),
      transcriptChars: transcript.length,
    },
    hedgingCount: Math.max(0, Math.round(numberValue(rawReview.hedgingCount, 0))),
    metricPlacement: normalizeMetricPlacement(rawReview.metricPlacement),
    structure: {
      opening: Boolean(structure.opening),
      body: Boolean(structure.body),
      close: Boolean(structure.close),
    },
    jargonFlags: cleanList(rawReview.jargonFlags, 5, 140),
    lengthVerdict: normalizeLengthVerdict(rawReview.lengthVerdict),
    diagnosis: stringValue(rawReview.diagnosis, 280),
    strengths: cleanList(rawReview.strengths, 4, 220),
    fixes: cleanList(rawReview.fixes, 5, 240),
    betterAnswer: stringValue(rawReview.betterAnswer, 2200),
    nextDrill: stringValue(rawReview.nextDrill, 400),
  };
};

const generateWithAnthropic = async ({ provider, prompt }) => {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1400,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Anthropic request failed (${response.status})`;
    throw new Error(message);
  }
  const text = Array.isArray(payload.content)
    ? payload.content.filter((item) => item?.type === "text").map((item) => item.text || "").join("\n")
    : "";
  if (!text) throw new Error("No text returned from Anthropic");
  return text;
};

const buildSpeechReviewProviders = () => {
  const forced = stringValue(process.env.JOB_DIGEST_SPEECH_REVIEW_PROVIDER || "", 40).toLowerCase();
  const providers = [];

  if (process.env.ANTHROPIC_API_KEY && (!forced || forced === "anthropic" || forced === "claude")) {
    providers.push({
      kind: "anthropic",
      name: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: DEFAULT_ANTHROPIC_MODEL,
    });
  }

  if (!forced || forced !== "anthropic") {
    buildTextProviders().forEach((provider) => {
      if (!forced || forced === provider.name) {
        providers.push({
          ...provider,
          kind: "openai-compatible",
        });
      }
    });
  }

  return providers;
};

const generateAiSpeechReview = async (session = {}) => {
  const transcript = stringValue(session.transcript || session.whisperTranscript || session.webSpeechTranscript, MAX_TRANSCRIPT_CHARS);
  if (transcript.length < 20) {
    return {
      status: "skipped",
      providerConfigured: Boolean(buildSpeechReviewProviders().length),
      reason: "Transcript too short for AI review",
      review: null,
    };
  }

  const providers = buildSpeechReviewProviders();
  if (!providers.length) {
    const reason = "No speech review LLM provider configured";
    return {
      status: "fallback",
      providerConfigured: false,
      reason,
      review: buildFallbackReview({ session: { ...session, transcript }, reason, providerConfigured: false }),
    };
  }

  const prompt = buildSpeechReviewPrompt({ ...session, transcript });
  const errors = [];
  for (const provider of providers) {
    try {
      const text =
        provider.kind === "anthropic"
          ? await generateWithAnthropic({ provider, prompt })
          : await generateTextWithProvider({ provider, prompt, temperature: 0.2, maxTokens: 1400 });
      const rawReview = safeJsonParse(text);
      const review = normalizeAiReview({ rawReview, session: { ...session, transcript }, provider });
      return {
        status: "complete",
        providerConfigured: true,
        provider: provider.name,
        model: provider.model,
        review,
      };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message || error}`);
    }
  }

  return {
    status: "fallback",
    providerConfigured: true,
    reason: errors.join(" | ").slice(0, 1000) || "AI review failed",
    review: buildFallbackReview({
      session: { ...session, transcript },
      reason: errors.join(" | ").slice(0, 1000) || "AI review failed",
      providerConfigured: true,
    }),
  };
};

module.exports = {
  buildSpeechReviewPrompt,
  buildSpeechReviewProviders,
  calculateCombinedScore,
  generateAiSpeechReview,
  normalizeAiReview,
  safeJsonParse,
};
