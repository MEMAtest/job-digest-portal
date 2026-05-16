import { describe, expect, it } from "vitest";
import {
  buildSessionPayload,
  calculateSpeechScore,
  calculateTrend,
  detectFillers,
  rescoreSessionWithTranscript,
  selectQuestion,
} from "../app.speechcoach.logic.js";

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
    expect(typeof parsed.createdAtIso).toBe("string");
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
      whisperModel: "test-whisper",
      transcriptionSource: "whisper",
      totalFillers: 2,
      topFiller: "I think",
    });
    expect(rescored.fillerCounts["I think"]).toBe(1);
    expect(rescored.fillerCounts.probably).toBe(1);
  });
});
