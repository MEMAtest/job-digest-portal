import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import {
  buildSessionPayload,
  calculateSpeechPatterns,
  calculateSpeechScore,
  calculateTrend,
  detectFillers,
  rescoreSessionWithTranscript,
  reviewSpeechAnswer,
  selectQuestion,
} from "../app.speechcoach.logic.js";

const require = createRequire(import.meta.url);
const {
  calculateCombinedScore,
  generateAiSpeechReview,
  normalizeAiReview,
  safeJsonParse,
} = require("../netlify/functions/_speech_ai_review.js");
const fs = require("fs");

describe("detectFillers", () => {
  it("counts multi-word and single-word fillers", () => {
    const result = detectFillers("I kind of think it's probably fine");
    expect(result.counts["kind of"]).toBe(1);
    expect(result.counts["probably"]).toBe(1);
    expect(result.counts["I think"]).toBe(1);
  });

  it("counts I think when said directly", () => {
    const result = detectFillers("I think it's probably kind of important");
    expect(result.counts["I think"]).toBe(1);
    expect(result.counts.probably).toBe(1);
    expect(result.counts["kind of"]).toBe(1);
  });

  it("does not count comparative like", () => {
    const result = detectFillers("tools like Fenergo are relevant");
    expect(result.counts.like).toBe(0);
  });

  it("counts filler like", () => {
    const result = detectFillers("I was like, no way. And like, I needed to respond.");
    expect(result.counts.like).toBe(2);
  });

  it("counts repeated fillers", () => {
    const result = detectFillers("kind of, kind of, kind of");
    expect(result.counts["kind of"]).toBe(3);
  });

  it("handles empty text", () => {
    const result = detectFillers("");
    expect(result.total).toBe(0);
  });

  it("handles punctuation around fillers", () => {
    const result = detectFillers("probably. maybe, obviously!");
    expect(result.counts.probably).toBe(1);
    expect(result.counts.maybe).toBe(1);
    expect(result.counts.obviously).toBe(1);
  });
});

describe("calculateSpeechScore", () => {
  it("scores clean 75s answer as 100", () => {
    expect(calculateSpeechScore({ duration: 75, totalFillers: 0, transcript: "word ".repeat(150) }).score).toBe(100);
  });

  it("applies fpm penalty", () => {
    expect(calculateSpeechScore({ duration: 60, totalFillers: 5, transcript: "word ".repeat(130) }).score).toBe(76);
  });

  it("clamps heavy filler penalty to zero", () => {
    expect(calculateSpeechScore({ duration: 30, totalFillers: 10, transcript: "word ".repeat(80) }).score).toBe(0);
  });

  it("applies long-answer penalty", () => {
    expect(calculateSpeechScore({ duration: 101, totalFillers: 0, transcript: "word ".repeat(220) }).score).toBe(95);
  });

  it("applies short-answer and pace penalty", () => {
    expect(calculateSpeechScore({ duration: 20, totalFillers: 0, transcript: "short answer" }).score).toBe(87);
  });
});

describe("selectQuestion", () => {
  const questions = [
    { id: "a", category: "behavioural" },
    { id: "b", category: "behavioural" },
    { id: "c", category: "domain" },
  ];

  it("filters by category", () => {
    const result = selectQuestion(questions, { categories: ["domain"], random: () => 0 });
    expect(result.question.id).toBe("c");
  });

  it("avoids repeats until exhausted", () => {
    const asked = new Set(["a"]);
    const result = selectQuestion(questions, { categories: ["behavioural"], asked, random: () => 0 });
    expect(result.question.id).toBe("b");
  });

  it("resets after exhaustion", () => {
    const result = selectQuestion(questions, { categories: ["behavioural"], asked: new Set(["a", "b"]), random: () => 0 });
    expect(result.reset).toBe(true);
    expect(result.question.id).toBe("a");
  });

  it("weights low-score questions higher for spaced repetition", () => {
    const result = selectQuestion(questions, {
      categories: ["behavioural"],
      sessions: [{ questionId: "a", score: 40, createdAtIso: "2026-05-16T00:00:00.000Z" }],
      random: () => 0.55,
    });
    expect(result.question.id).toBe("a");
  });

  it("deprioritises recently strong questions", () => {
    const result = selectQuestion(questions, {
      categories: ["behavioural"],
      sessions: [{ questionId: "a", score: 95, createdAtIso: "2026-05-16T00:00:00.000Z" }],
      now: new Date("2026-05-17T00:00:00.000Z"),
      random: () => 0.3,
    });
    expect(result.question.id).toBe("b");
  });
});

describe("calculateTrend", () => {
  it("returns null for fewer than 5 sessions", () => {
    expect(calculateTrend([{ fpm: 3 }, { fpm: 3 }, { fpm: 3 }, { fpm: 3 }])).toBeNull();
  });

  it("returns flat for 5 sessions with the same fpm", () => {
    const sessions = Array.from({ length: 5 }, (_, idx) => ({
      fpm: 3,
      createdAtIso: `2026-05-${String(15 - idx).padStart(2, "0")}T00:00:00.000Z`,
    }));
    expect(calculateTrend(sessions)).toMatchObject({ direction: "flat", delta: 0 });
  });

  it("detects improvement", () => {
    const sessions = Array.from({ length: 10 }, (_, idx) => ({
      fpm: idx < 5 ? 3 : 6,
      createdAtIso: `2026-05-${String(15 - idx).padStart(2, "0")}T00:00:00.000Z`,
    }));
    expect(calculateTrend(sessions)).toMatchObject({ direction: "improving", delta: 3 });
  });
});

describe("calculateSpeechPatterns", () => {
  it("detects late metrics and weak closes across recent sessions", () => {
    const sessions = Array.from({ length: 6 }, (_, idx) => ({
      id: `s${idx}`,
      createdAtIso: `2026-05-${String(17 - idx).padStart(2, "0")}T00:00:00.000Z`,
      score: 70,
      fpm: 2,
      speechReview: { metrics: { hasMetric: idx > 4, hasEvidence: true, hasClose: false } },
      aiReview: { metricPlacement: idx > 4 ? "first_15s" : "later", structure: { close: false } },
    }));
    const patterns = calculateSpeechPatterns(sessions);
    expect(patterns.map((pattern) => pattern.title)).toContain("Metric arrives too late");
    expect(patterns.map((pattern) => pattern.title)).toContain("Close is not landing");
  });

  it("returns a healthy pattern when recent score and fpm are strong", () => {
    const sessions = Array.from({ length: 4 }, (_, idx) => ({
      id: `s${idx}`,
      createdAtIso: `2026-05-${String(17 - idx).padStart(2, "0")}T00:00:00.000Z`,
      score: 85,
      fpm: 1.5,
      speechReview: { metrics: { hasMetric: true, hasEvidence: true, hasClose: true } },
      aiReview: { metricPlacement: "first_15s", structure: { close: true } },
    }));
    expect(calculateSpeechPatterns(sessions)[0]).toMatchObject({ severity: "green", title: "Recent pattern is healthy" });
  });
});

describe("buildSessionPayload", () => {
  it("round-trips through JSON without losing key fields", () => {
    const payload = buildSessionPayload({
      sessionId: "abc",
      jobId: "job-1",
      question: { id: "q1", text: "Question?", category: "product" },
      transcript: `I think ${"word ".repeat(130)}`,
      duration: 60,
      fillerCounts: detectFillers("I think this is fine").counts,
      audioRef: "speech-audio/abc.webm",
      device: "test",
    });
    const parsed = JSON.parse(JSON.stringify(payload));
    expect(parsed).toMatchObject({
      id: "abc",
      jobId: "job-1",
      questionId: "q1",
      score: 100,
      totalFillers: 1,
      audioRef: "speech-audio/abc.webm",
    });
    expect(parsed.speechReview.score).toBeGreaterThan(0);
    expect(typeof parsed.createdAtIso).toBe("string");
  });

  it("can save an audio-only mobile session while transcript is pending", () => {
    const payload = buildSessionPayload({
      sessionId: "mobile-audio",
      question: { id: "q1", text: "Question?", category: "domain" },
      transcript: "",
      duration: 62,
      fillerCounts: detectFillers("").counts,
      transcriptionSource: "audio_pending",
      transcriptPending: true,
      audioCaptured: true,
      captureDiagnostics: {
        audioBytes: 2048,
        audioChunkCount: 2,
        recorderMimeType: "audio/webm",
        recorderStopTimedOut: false,
        transcriptChars: 0,
      },
    });

    expect(payload).toMatchObject({
      id: "mobile-audio",
      transcript: "",
      webSpeechTranscript: "",
      transcriptionSource: "audio_pending",
      transcriptPending: true,
      audioCaptured: true,
      scoreType: "transcript_pending",
      score: 0,
      totalFillers: 0,
      fpm: 0,
      wpm: 0,
      captureDiagnostics: {
        audioBytes: 2048,
        audioChunkCount: 2,
        recorderMimeType: "audio/webm",
      },
      speechReview: null,
    });
  });
});

describe("rescoreSessionWithTranscript", () => {
  it("uses the Whisper transcript as canonical and recalculates filler counts", () => {
    const session = buildSessionPayload({
      sessionId: "abc",
      question: { id: "q1", text: "Question?", category: "product" },
      transcript: "clean " + "word ".repeat(120),
      duration: 60,
      fillerCounts: detectFillers("clean").counts,
    });
    const rescored = rescoreSessionWithTranscript(session, `I think probably ${"word ".repeat(120)}`, {
      model: "test-whisper",
    });
    expect(rescored).toMatchObject({
      id: "abc",
      rescored: true,
      transcriptPending: false,
      whisperModel: "test-whisper",
      transcriptionSource: "whisper",
      totalFillers: 2,
      topFiller: "I think",
    });
    expect(rescored.fillerCounts["I think"]).toBe(1);
    expect(rescored.fillerCounts.probably).toBe(1);
    expect(rescored.speechReview.verdict).toBeTruthy();
  });
});

describe("reviewSpeechAnswer", () => {
  it("rewards metric-led structured answers with evidence", () => {
    const review = reviewSpeechAnswer({
      transcript:
        "I would frame this through the Ebury screening example. The problem was unnecessary manual reviews from blunt thresholds. I mapped alert quality, worked with Compliance and changed the LexisNexis API handling. The result was 38% fewer unnecessary reviews while keeping control comfort, which is relevant because the role needs risk and customer experience balanced.",
      modelAnswer:
        "Use Ebury. Baseline alert volumes, alert quality, true positives and false positives. Tune thresholds with Compliance sign-off. Result: 38% reduction in unnecessary manual reviews while preserving control comfort.",
      duration: 75,
      fillerCounts: detectFillers("").counts,
      fpm: 0,
      wpm: 145,
      category: "domain",
    });
    expect(review.score).toBeGreaterThanOrEqual(75);
    expect(review.strengths.length).toBeGreaterThan(0);
    expect(review.betterAnswer).toContain("Ebury");
  });

  it("flags short unstructured answers", () => {
    const review = reviewSpeechAnswer({
      transcript: "I think it was good and probably relevant.",
      modelAnswer: "Use Vistra, workflow redesign, cycle-time reduction and stakeholder alignment.",
      duration: 8,
      fillerCounts: detectFillers("I think it was probably good").counts,
      fpm: 15,
      wpm: 80,
      category: "behavioural",
    });
    expect(review.score).toBeLessThan(65);
    expect(review.fixes.join(" ")).toMatch(/metric|Open|Develop|fillers/i);
  });
});

describe("Phase 3 AI review helpers", () => {
  it("calculates the blended score from filler, clarity, structure and duration", () => {
    const result = calculateCombinedScore({
      clarityScore: 80,
      structureScore: 70,
      fpm: 3,
      duration: 75,
    });
    expect(result).toMatchObject({
      fillerScore: 88,
      durationScore: 100,
      combinedScore: 85,
    });
  });

  it("normalizes model output into the stored AI review shape", () => {
    const review = normalizeAiReview({
      rawReview: {
        clarityScore: 82,
        structureScore: 75,
        confidenceScore: 70,
        hedgingCount: 2,
        metricPlacement: "later",
        structure: { opening: true, body: true, close: false },
        jargonFlags: ["unclear platform phrasing"],
        lengthVerdict: "tight",
        diagnosis: "Specific but the metric arrives too late.",
        strengths: ["Relevant Ebury evidence"],
        fixes: ["Lead with the 38% result"],
        betterAnswer: "I would lead with the Ebury threshold example.",
        nextDrill: "Repeat with metric in sentence one.",
      },
      session: { duration: 80, fpm: 2.5, wpm: 130, totalFillers: 3, transcript: "word ".repeat(130) },
      provider: { name: "test", model: "test-model" },
    });
    expect(review).toMatchObject({
      status: "complete",
      provider: "test",
      model: "test-model",
      metricPlacement: "later",
      lengthVerdict: "tight",
      hedgingCount: 2,
    });
    expect(review.combinedScore).toBeGreaterThan(80);
    expect(review.components.clarityScore).toBe(82);
  });

  it("parses fenced JSON AI responses", () => {
    expect(safeJsonParse("```json\n{\"clarityScore\":88}\n```")).toEqual({ clarityScore: 88 });
  });

  it("falls back locally when no external provider is configured", async () => {
    const previousOpenAi = process.env.OPENAI_API_KEY;
    const previousGroq = process.env.GROQ_API_KEY;
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await generateAiSpeechReview({
        questionText: "How would you improve screening?",
        questionModelAnswer: "Use Ebury and the 38% false-positive reduction.",
        transcript: "I would use Ebury. The result was 38% fewer unnecessary manual reviews while preserving control comfort.",
        duration: 70,
        fpm: 0,
        wpm: 110,
        totalFillers: 0,
      });
      expect(result.status).toBe("fallback");
      expect(result.review.status).toBe("fallback");
      expect(result.review.provider).toBe("local-fallback");
      expect(result.review.combinedScore).toBeGreaterThan(0);
    } finally {
      if (previousOpenAi) process.env.OPENAI_API_KEY = previousOpenAi;
      if (previousGroq) process.env.GROQ_API_KEY = previousGroq;
      if (previousOpenRouter) process.env.OPENROUTER_API_KEY = previousOpenRouter;
      if (previousAnthropic) process.env.ANTHROPIC_API_KEY = previousAnthropic;
    }
  });
});

describe("speech question model answers", () => {
  it("answers the PEP, sanctions, adverse media and transaction monitoring comparison directly", () => {
    const questions = JSON.parse(fs.readFileSync("speech-questions.json", "utf8"));
    const question = questions.find((item) => item.id === "dom-11");
    expect(question.text).toMatch(/PEP, sanctions, adverse media and transaction monitoring/i);
    expect(question.modelAnswer).toMatch(/PEP/i);
    expect(question.modelAnswer).toMatch(/Sanctions/i);
    expect(question.modelAnswer).toMatch(/Adverse media/i);
    expect(question.modelAnswer).toMatch(/Transaction monitoring/i);
    expect(question.modelAnswer).toMatch(/different data|SLAs|false-positive patterns|governance/i);
  });
});
