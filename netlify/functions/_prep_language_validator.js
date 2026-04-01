const FORBIDDEN_PHRASES = [
  "results-driven",
  "proven track record",
  "seasoned professional",
  "seasoned leader",
  "dynamic professional",
  "adept at",
  "extensive experience",
  "leverage",
  "spearheaded",
  "utilised",
  "utilized",
  "delve",
  "strong understanding",
  "strong commercial acumen",
  "strategic thinker",
  "passionate about",
  "in my current role i am responsible for",
];

const GENERIC_OPENERS = [
  /^i am\b/i,
  /^i have\b/i,
  /^with over\b/i,
  /^results-driven\b/i,
  /^as a\b/i,
  /^proven track record\b/i,
  /^within the\b/i,
  /^skilled in\b/i,
  /^adept at\b/i,
];

const WRITTEN_PROSE_MARKERS = [
  "therefore",
  "moreover",
  "furthermore",
  "in addition",
  "subsequently",
  "consequently",
  "thus",
  "hence",
];

const DOMAIN_ANCHORS = [
  "financial crime",
  "fraud",
  "kyc",
  "aml",
  "screening",
  "sanctions",
  "transaction monitoring",
  "client onboarding",
  "onboarding",
  "client lifecycle",
  "clm",
  "fenergo",
  "payments",
  "fintech",
  "product",
  "compliance",
  "regulatory",
  "risk",
  "controls",
  "operations",
];

const METRIC_PATTERN = /(?:£\s?\d[\d,.]*(?:k|m|bn)?|\b\d+(?:\.\d+)?\s?(?:%|days?|weeks?|months?|hours?|records?|clients?|markets?|jurisdictions?|people|arr)\b)/gi;

const SPOKEN_FIELD_RULES = {
  spoken_intro_60s: { minWords: 90, maxWords: 185, maxSentences: 6, requireDomainAnchor: true },
  spoken_intro_90s: { minWords: 130, maxWords: 260, maxSentences: 9, requireDomainAnchor: true },
  spoken_why_role: { minWords: 70, maxWords: 150, maxSentences: 5, requireDomainAnchor: true, requireJobSpecificity: true },
  spoken_working_style: { minWords: 70, maxWords: 150, maxSentences: 5, requireDomainAnchor: false },
  spoken_story_hook: { minWords: 10, maxWords: 55, maxSentences: 2, requireDomainAnchor: false },
  spoken_story_full: { minWords: 90, maxWords: 190, maxSentences: 7, requireDomainAnchor: false, forbidStarLabels: true },
  power_question: { minWords: 6, maxWords: 22, maxSentences: 1, requireDomainAnchor: false },
};

const DEBRIEF_FIELD_RULES = {
  debrief_summary: { minWords: 18, maxWords: 110, maxSentences: 4 },
  debrief_improved: { minWords: 75, maxWords: 185, maxSentences: 7, requireDomainAnchor: false },
  debrief_why_better: { minWords: 8, maxWords: 35, maxSentences: 2 },
  debrief_focus: { minWords: 4, maxWords: 18, maxSentences: 1 },
  debrief_watch_out: { minWords: 4, maxWords: 18, maxSentences: 1 },
  debrief_strength: { minWords: 4, maxWords: 18, maxSentences: 1 },
};

const ANALYSIS_FIELD_RULES = {
  analysis_verdict: { minWords: 25, maxWords: 120, maxSentences: 5 },
  analysis_dimension_note: { minWords: 5, maxWords: 24, maxSentences: 1 },
  analysis_strength: { minWords: 4, maxWords: 22, maxSentences: 1 },
  analysis_gap: { minWords: 4, maxWords: 22, maxSentences: 1 },
  analysis_signal: { minWords: 4, maxWords: 24, maxSentences: 1 },
  analysis_implication: { minWords: 5, maxWords: 24, maxSentences: 1 },
  analysis_prep: { minWords: 4, maxWords: 22, maxSentences: 1 },
  analysis_core_gap: { minWords: 6, maxWords: 24, maxSentences: 1 },
};

const sanitizeText = (value) =>
  String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const countWords = (text) => sanitizeText(text).split(/\s+/).filter(Boolean).length;

const splitSentences = (text) =>
  sanitizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const extractMetrics = (text) => {
  const matches = sanitizeText(text).match(METRIC_PATTERN) || [];
  return Array.from(new Set(matches.map((match) => match.toLowerCase())));
};

const getOpeningFragment = (text, wordCount = 4) =>
  sanitizeText(text)
    .split(/\s+/)
    .slice(0, wordCount)
    .join(" ")
    .toLowerCase();

const buildDecision = ({ score, errors, warnings }) => {
  if (errors.length || score < 60) return "fallback";
  if (warnings.length || score < 84) return "retry";
  return "accept";
};

const validateTextBlock = (text, fieldName, rules = {}, context = {}) => {
  const value = sanitizeText(text);
  const errors = [];
  const warnings = [];
  let score = 100;

  if (!value) {
    return {
      field: fieldName,
      text: value,
      score: 0,
      decision: "fallback",
      errors: [`${fieldName} is empty.`],
      warnings: [],
      metrics: { words: 0, sentences: 0, metrics: [] },
    };
  }

  const words = countWords(value);
  const sentences = splitSentences(value);
  const longSentences = sentences.filter((sentence) => countWords(sentence) > 32).length;
  const metrics = extractMetrics(value);
  const opener = getOpeningFragment(value);
  const lower = value.toLowerCase();

  if (rules.minWords && words < rules.minWords) {
    const message = `${fieldName} is too short for a natural spoken answer.`;
    if (words < Math.max(8, rules.minWords - 25)) {
      errors.push(message);
      score -= 16;
    } else {
      warnings.push(message);
      score -= 8;
    }
  }

  if (rules.maxWords && words > rules.maxWords) {
    const message = `${fieldName} is too long to say naturally.`;
    if (words > rules.maxWords + 30) {
      errors.push(message);
      score -= 16;
    } else {
      warnings.push(message);
      score -= 8;
    }
  }

  if (rules.maxSentences && sentences.length > rules.maxSentences) {
    warnings.push(`${fieldName} has too many sentences.`);
    score -= 6;
  }

  if (longSentences >= 3) {
    warnings.push(`${fieldName} has too many long written-style sentences.`);
    score -= 8;
  }

  const colonCount = (value.match(/:/g) || []).length;
  if ((/;/.test(value) || colonCount > 1) && fieldName !== "power_question") {
    warnings.push(`${fieldName} reads more like written prose than spoken language.`);
    score -= 4;
  }

  if (/[—→]/.test(value)) {
    errors.push(`${fieldName} uses presentation-style punctuation.`);
    score -= 10;
  }

  if (GENERIC_OPENERS.some((pattern) => pattern.test(value))) {
    errors.push(`${fieldName} opens with generic CV-style phrasing.`);
    score -= 16;
  }

  const forbiddenHits = FORBIDDEN_PHRASES.filter((phrase) => lower.includes(phrase));
  if (forbiddenHits.length) {
    errors.push(`${fieldName} uses banned generic phrases: ${forbiddenHits.join(", ")}.`);
    score -= forbiddenHits.length * 10;
  }

  const proseHits = WRITTEN_PROSE_MARKERS.filter((phrase) => lower.includes(phrase));
  if (proseHits.length) {
    warnings.push(`${fieldName} uses formal written connectors.`);
    score -= proseHits.length * 3;
  }

  if (rules.requireDomainAnchor && !DOMAIN_ANCHORS.some((anchor) => lower.includes(anchor))) {
    errors.push(`${fieldName} does not anchor itself in a concrete domain or operating context.`);
    score -= 10;
  }

  if (
    rules.requireJobSpecificity &&
    ![context.jobRole, context.jobCompany].filter(Boolean).some((item) => lower.includes(String(item).toLowerCase()))
  ) {
    warnings.push(`${fieldName} is not specific enough to the target role or company.`);
    score -= 6;
  }

  if (rules.forbidStarLabels && /\b(situation|task|action|result)\s*:/i.test(value)) {
    errors.push(`${fieldName} exposes STAR labels instead of sounding spoken.`);
    score -= 16;
  }

  if (fieldName === "power_question" && /\?$/.test(value) === false) {
    warnings.push("power_question should read as a direct question.");
    score -= 3;
  }

  return {
    field: fieldName,
    text: value,
    score: Math.max(0, score),
    decision: buildDecision({ score: Math.max(0, score), errors, warnings }),
    errors,
    warnings,
    metrics: {
      words,
      sentences: sentences.length,
      longSentences,
      opener,
      metrics,
    },
  };
};

const collectPayloadLevelIssues = (results, { allowMetricRepetition = false } = {}) => {
  const warnings = [];
  const errors = [];
  let scorePenalty = 0;

  const openerCounts = new Map();
  results
    .filter((result) => !/_hook\b/.test(result.field))
    .forEach((result) => {
    const opener = result.metrics?.opener || "";
    if (!opener) return;
    openerCounts.set(opener, (openerCounts.get(opener) || 0) + 1);
    });

  const repeatedOpeners = Array.from(openerCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([opener]) => opener);

  if (repeatedOpeners.length) {
    warnings.push(`Repeated openings across answers: ${repeatedOpeners.join(", ")}.`);
    scorePenalty += 6;
  }

  const metricCounts = new Map();
  results.forEach((result) => {
    for (const metric of result.metrics?.metrics || []) {
      metricCounts.set(metric, (metricCounts.get(metric) || 0) + 1);
    }
  });

  const repeatedMetrics = Array.from(metricCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([metric]) => metric);

  if (repeatedMetrics.length && !allowMetricRepetition) {
    warnings.push(`Repeated metrics across sections: ${repeatedMetrics.join(", ")}.`);
    scorePenalty += 6;
  }

  return {
    warnings,
    errors,
    scorePenalty,
    repeatedOpeners,
    repeatedMetrics,
  };
};

const summarizeValidation = (results, payloadIssues) => {
  const errors = results.flatMap((result) => result.errors).concat(payloadIssues.errors);
  const warnings = results.flatMap((result) => result.warnings).concat(payloadIssues.warnings);
  const averageScore =
    results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length) : 0;
  const qualityScore = Math.max(0, averageScore - payloadIssues.scorePenalty);
  const decision = buildDecision({ score: qualityScore, errors, warnings });

  return {
    ok: decision === "accept",
    decision,
    quality_score: qualityScore,
    errors,
    warnings,
  };
};

const validateSpokenPayload = (payload, context = {}) => {
  const results = [];
  results.push(validateTextBlock(payload?.spoken_intro_60s, "spoken_intro_60s", SPOKEN_FIELD_RULES.spoken_intro_60s, context));
  results.push(validateTextBlock(payload?.spoken_intro_90s, "spoken_intro_90s", SPOKEN_FIELD_RULES.spoken_intro_90s, context));
  results.push(validateTextBlock(payload?.spoken_why_role, "spoken_why_role", SPOKEN_FIELD_RULES.spoken_why_role, context));
  results.push(validateTextBlock(payload?.spoken_working_style, "spoken_working_style", SPOKEN_FIELD_RULES.spoken_working_style, context));

  const spokenStories = Array.isArray(payload?.spoken_stories) ? payload.spoken_stories : [];
  if (spokenStories.length < 3) {
    results.push({
      field: "spoken_stories",
      text: "",
      score: 0,
      decision: "fallback",
      errors: ["spoken_stories must contain 3 stories."],
      warnings: [],
      metrics: { words: 0, sentences: 0, metrics: [], opener: "" },
    });
  }

  spokenStories.slice(0, 3).forEach((story, index) => {
    results.push(
      validateTextBlock(story?.hook, `spoken_story_${index + 1}_hook`, SPOKEN_FIELD_RULES.spoken_story_hook, context)
    );
    results.push(
      validateTextBlock(story?.full, `spoken_story_${index + 1}_full`, SPOKEN_FIELD_RULES.spoken_story_full, context)
    );
  });

  const powerQuestions = Array.isArray(payload?.power_questions) ? payload.power_questions : [];
  if (powerQuestions.length < 3) {
    results.push({
      field: "power_questions",
      text: "",
      score: 0,
      decision: "fallback",
      errors: ["power_questions must contain at least 3 questions."],
      warnings: [],
      metrics: { words: 0, sentences: 0, metrics: [], opener: "" },
    });
  }

  powerQuestions.slice(0, 5).forEach((question, index) => {
    results.push(validateTextBlock(question, `power_question_${index + 1}`, SPOKEN_FIELD_RULES.power_question, context));
  });

  const payloadIssues = collectPayloadLevelIssues(results);
  const summary = summarizeValidation(results, payloadIssues);
  return {
    ...summary,
    field_results: results,
    repeated_openers: payloadIssues.repeatedOpeners,
    repeated_metrics: payloadIssues.repeatedMetrics,
  };
};

const validateDebriefPayload = (payload, context = {}) => {
  const results = [];
  const questions = Array.isArray(payload?.debrief_questions) ? payload.debrief_questions : [];

  if (!questions.length) {
    results.push({
      field: "debrief_questions",
      text: "",
      score: 0,
      decision: "fallback",
      errors: ["debrief_questions is empty."],
      warnings: [],
      metrics: { words: 0, sentences: 0, metrics: [], opener: "" },
    });
  }

  questions.slice(0, 8).forEach((question, index) => {
    results.push(validateTextBlock(question?.your_answer_summary, `debrief_summary_${index + 1}`, DEBRIEF_FIELD_RULES.debrief_summary, context));
    results.push(validateTextBlock(question?.improved_answer, `debrief_improved_${index + 1}`, DEBRIEF_FIELD_RULES.debrief_improved, context));
    results.push(validateTextBlock(question?.why_better, `debrief_why_better_${index + 1}`, DEBRIEF_FIELD_RULES.debrief_why_better, context));
  });

  const addListResults = (items, fieldPrefix, rules) => {
    (Array.isArray(items) ? items : []).slice(0, 6).forEach((item, index) => {
      results.push(validateTextBlock(item, `${fieldPrefix}_${index + 1}`, rules, context));
    });
  };

  addListResults(payload?.debrief_round2_focus, "debrief_focus", DEBRIEF_FIELD_RULES.debrief_focus);
  addListResults(payload?.debrief_watch_outs, "debrief_watch_out", DEBRIEF_FIELD_RULES.debrief_watch_out);
  addListResults(payload?.debrief_strengths, "debrief_strength", DEBRIEF_FIELD_RULES.debrief_strength);

  const payloadIssues = collectPayloadLevelIssues(results, { allowMetricRepetition: true });
  const summary = summarizeValidation(results, payloadIssues);
  return {
    ...summary,
    field_results: results,
    repeated_openers: payloadIssues.repeatedOpeners,
    repeated_metrics: payloadIssues.repeatedMetrics,
  };
};

const validateInterviewAnalysisPayload = (payload, context = {}) => {
  const results = [];

  results.push(validateTextBlock(payload?.overall_verdict, "analysis_verdict", ANALYSIS_FIELD_RULES.analysis_verdict, context));
  (Array.isArray(payload?.dimension_scores) ? payload.dimension_scores : []).forEach((item, index) => {
    results.push(validateTextBlock(item?.note, `analysis_dimension_note_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_dimension_note, context));
  });
  (Array.isArray(payload?.strengths) ? payload.strengths : []).forEach((item, index) => {
    results.push(validateTextBlock(item, `analysis_strength_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_strength, context));
  });
  (Array.isArray(payload?.gaps) ? payload.gaps : []).forEach((item, index) => {
    results.push(validateTextBlock(item, `analysis_gap_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_gap, context));
  });
  (Array.isArray(payload?.intelligence_gathered) ? payload.intelligence_gathered : []).forEach((item, index) => {
    results.push(validateTextBlock(item?.signal, `analysis_signal_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_signal, context));
    results.push(validateTextBlock(item?.implication, `analysis_implication_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_implication, context));
  });
  (Array.isArray(payload?.next_round_prep) ? payload.next_round_prep : []).forEach((item, index) => {
    results.push(validateTextBlock(item, `analysis_prep_${index + 1}`, ANALYSIS_FIELD_RULES.analysis_prep, context));
  });
  results.push(validateTextBlock(payload?.core_gap_summary, "analysis_core_gap", ANALYSIS_FIELD_RULES.analysis_core_gap, context));

  const payloadIssues = collectPayloadLevelIssues(results, { allowMetricRepetition: true });
  const summary = summarizeValidation(results, payloadIssues);
  return {
    ...summary,
    field_results: results,
    repeated_openers: payloadIssues.repeatedOpeners,
    repeated_metrics: payloadIssues.repeatedMetrics,
  };
};

const buildRetryFeedback = (validation) => {
  const issues = [
    ...(validation?.errors || []).slice(0, 6),
    ...(validation?.warnings || []).slice(0, 6),
  ];
  if (!issues.length) return "";
  return issues.map((issue) => `- ${issue}`).join("\n");
};

const getDecisionRank = (decision) => {
  if (decision === "accept") return 3;
  if (decision === "retry") return 2;
  return 1;
};

const chooseBetterCandidate = (left, right) => {
  const decisionDiff = getDecisionRank(left.validation?.decision) - getDecisionRank(right.validation?.decision);
  if (decisionDiff !== 0) return decisionDiff;
  const scoreDiff = (left.validation?.quality_score || 0) - (right.validation?.quality_score || 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (right.validation?.warnings?.length || 0) - (left.validation?.warnings?.length || 0);
};

module.exports = {
  validateTextBlock,
  validateSpokenPayload,
  validateDebriefPayload,
  validateInterviewAnalysisPayload,
  buildRetryFeedback,
  chooseBetterCandidate,
};
