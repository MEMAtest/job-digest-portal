import { chromium } from "playwright";

const args = process.argv.slice(2);

const parseArg = (name, fallback = "") => {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = args.findIndex((arg) => arg === name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
};

const baseUrl = parseArg("--url", "https://adejob.netlify.app/");
const timeoutMs = Number.parseInt(parseArg("--timeout-ms", "30000"), 10) || 30000;
const headed = args.includes("--headed");
const FINAL_TRANSCRIPT =
  "I would compare the operating model first. PEP screening is relationship led, sanctions is list led, adverse media is intelligence led and transaction monitoring is behaviour led.";

const scenarios = [
  {
    name: "audio-only fallback saves pending",
    recorderMode: "chunks",
    recognitionMode: "none",
    expect: { pending: true, saved: true, uploaded: true, audioCaptured: true, transcript: "" },
  },
  {
    name: "no audio and no transcript is rejected clearly",
    recorderMode: "empty",
    recognitionMode: "none",
    expect: { notSaved: true, saved: false, uploaded: false },
  },
  {
    name: "transcript-only still saves scored session",
    recorderMode: "empty",
    recognitionMode: "final",
    expect: { pending: false, saved: true, uploaded: false, audioCaptured: false, transcript: FINAL_TRANSCRIPT },
  },
  {
    name: "recorder stop hang still resolves and saves pending",
    recorderMode: "hang-with-chunk",
    recognitionMode: "none",
    expect: { pending: true, saved: true, uploaded: true, audioCaptured: true, stopTimedOut: true, transcript: "" },
  },
];

const results = [];

const record = (name, ok, details = "") => {
  results.push({ name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
};

const installMocks = async (context, scenario) => {
  await context.addInitScript(
    ({ scenario, finalTranscript }) => {
      window.localStorage.setItem("speechCoach.whisperEnabled", "false");
      window.localStorage.setItem("speechCoach.aiReviewEnabled", "false");
      window.__speechMobileFallbackTest = {
        uploads: 0,
        saves: [],
        scenario,
      };

      const fakeTrack = {
        kind: "audio",
        readyState: "live",
        enabled: true,
        stop() {
          this.readyState = "ended";
        },
      };

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            active: true,
            id: "fake-mobile-mic-stream",
            getTracks: () => [fakeTrack],
            getAudioTracks: () => [fakeTrack],
          }),
        },
      });

      class FakeMediaRecorder {
        static isTypeSupported(type) {
          return /audio\/webm|audio\/mp4/.test(String(type || ""));
        }

        constructor(stream, options = {}) {
          this.stream = stream;
          this.mimeType = options.mimeType || "audio/webm";
          this.state = "inactive";
          this.ondataavailable = null;
          this.onstop = null;
          this.onerror = null;
        }

        start() {
          this.state = "recording";
          if (["chunks", "hang-with-chunk"].includes(scenario.recorderMode)) {
            setTimeout(() => this.emitChunk("start"), 100);
          }
        }

        requestData() {
          if (scenario.recorderMode === "chunks") this.emitChunk("request");
        }

        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          if (scenario.recorderMode === "hang-with-chunk") return;
          setTimeout(() => {
            if (scenario.recorderMode === "chunks") this.emitChunk("stop");
            if (typeof this.onstop === "function") this.onstop();
          }, 0);
        }

        emitChunk(label) {
          if (typeof this.ondataavailable !== "function") return;
          const data = new Blob([`fake-mobile-audio-${label}-${Date.now()}`], { type: this.mimeType });
          this.ondataavailable({ data });
        }
      }

      window.MediaRecorder = FakeMediaRecorder;

      class MockSpeechRecognition {
        constructor() {
          this.continuous = false;
          this.interimResults = false;
          this.lang = "en-GB";
          this.onresult = null;
          this.onerror = null;
          this.onend = null;
        }

        start() {
          setTimeout(() => {
            if (scenario.recognitionMode === "final" && !window.__speechMobileFallbackRecognitionEmitted) {
              window.__speechMobileFallbackRecognitionEmitted = true;
              if (typeof this.onresult === "function") {
                const result = { 0: { transcript: finalTranscript }, isFinal: true, length: 1 };
                this.onresult({ resultIndex: 0, results: [result] });
              }
            } else if (typeof this.onerror === "function") {
              this.onerror({ error: "no-speech" });
            }
            if (typeof this.onend === "function") this.onend();
          }, 100);
        }

        stop() {
          setTimeout(() => {
            if (typeof this.onend === "function") this.onend();
          }, 0);
        }
      }

      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input?.url || "";
        if (String(url).includes("/.netlify/functions/jobs")) {
          return new Response(
            JSON.stringify({
              ok: true,
              jobs: [],
              stats: [],
              suggestions: null,
              candidatePrep: null,
              meta: {
                source: "mock",
                collection: "speech-mobile-fallback-e2e",
                window_hours: 72,
                generated_at: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (String(url).includes("/.netlify/functions/speech-audio-upload")) {
          window.__speechMobileFallbackTest.uploads += 1;
          return new Response(
            JSON.stringify({ ok: true, audioRef: `smoke-audio/mobile-fallback-${Date.now()}.webm` }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (String(url).includes("/.netlify/functions/speech-session-save") && init?.body) {
          const payload = JSON.parse(String(init.body));
          payload.session = {
            ...(payload.session || {}),
            smokeTest: true,
            device: `playwright-mobile-fake-mic:${scenario.name}`,
          };
          window.__speechMobileFallbackTest.saves.push(payload.session);
          return originalFetch(input, { ...init, body: JSON.stringify(payload) });
        }

        return originalFetch(input, init);
      };
    },
    { scenario, finalTranscript: FINAL_TRANSCRIPT }
  );
};

const runScenario = async (browser, scenario) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await installMocks(context, scenario);

  const consoleErrors = [];
  const pageErrors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  try {
    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    record(`${scenario.name}: landing response`, Boolean(response?.ok()), response ? String(response.status()) : "no response");

    await page.getByRole("button", { name: "Speech Coach" }).click();
    await page.waitForSelector('.tab-section[data-tab="speechcoach"]:not(.hidden)', { timeout: timeoutMs });

    const whisperChecked = await page.locator("#speech-whisper-toggle").isChecked();
    const aiChecked = await page.locator("#speech-ai-review-toggle").isChecked();
    record(`${scenario.name}: heavy work disabled`, !whisperChecked && !aiChecked, `whisper=${whisperChecked} ai=${aiChecked}`);

    await page.getByRole("button", { name: "Start without read" }).click();
    await page.waitForFunction(() => /Recording/i.test(document.querySelector(".speech-status-line")?.textContent || ""), null, {
      timeout: timeoutMs,
    });
    await page.waitForTimeout(6500);
    await page.getByRole("button", { name: "Stop" }).click();

    if (scenario.expect.notSaved) {
      await page.waitForFunction(() => /Not saved/i.test(document.querySelector(".speech-status-line")?.textContent || ""), null, {
        timeout: timeoutMs,
      });
    } else {
      await page.waitForSelector(".speech-result", { timeout: timeoutMs });
    }

    const uiState = await page.evaluate(() => {
      const text = document.body.innerText;
      const test = window.__speechMobileFallbackTest || {};
      const lastSave = Array.isArray(test.saves) ? test.saves.at(-1) : null;
      return {
        hasPending: /Pending/i.test(text),
        hasAudioCaptured: /Audio captured/i.test(text),
        hasNotSaved: /Not saved/i.test(text),
        uploadCount: test.uploads || 0,
        saveCount: Array.isArray(test.saves) ? test.saves.length : 0,
        lastSave,
        status: document.querySelector(".speech-status-line")?.textContent?.trim() || "",
        result: document.querySelector(".speech-result")?.textContent?.replace(/\s+/g, " ").trim() || "",
      };
    });

    const summary = {
      status: uiState.status,
      result: uiState.result.slice(0, 180),
      saves: uiState.saveCount,
      uploads: uiState.uploadCount,
      transcriptPending: uiState.lastSave?.transcriptPending ?? null,
      audioCaptured: uiState.lastSave?.audioCaptured ?? null,
      audioBytes: uiState.lastSave?.captureDiagnostics?.audioBytes ?? null,
      stopTimedOut: uiState.lastSave?.captureDiagnostics?.recorderStopTimedOut ?? null,
      transcript: uiState.lastSave?.transcript ?? null,
    };

    if (scenario.expect.notSaved) {
      record(
        `${scenario.name}: rejected with clear not-saved state`,
        uiState.hasNotSaved && uiState.saveCount === 0 && uiState.uploadCount === 0,
        JSON.stringify(summary)
      );
    } else {
      record(`${scenario.name}: save call made`, uiState.saveCount === 1, JSON.stringify(summary));
      record(`${scenario.name}: upload expectation`, scenario.expect.uploaded ? uiState.uploadCount === 1 : uiState.uploadCount === 0, JSON.stringify(summary));
      record(`${scenario.name}: pending expectation`, Boolean(uiState.lastSave?.transcriptPending) === Boolean(scenario.expect.pending), JSON.stringify(summary));
      record(`${scenario.name}: audio captured expectation`, Boolean(uiState.lastSave?.audioCaptured) === Boolean(scenario.expect.audioCaptured), JSON.stringify(summary));
      if (scenario.expect.transcript !== undefined) {
        record(`${scenario.name}: transcript expectation`, uiState.lastSave?.transcript === scenario.expect.transcript, JSON.stringify(summary));
      }
      if (scenario.expect.stopTimedOut !== undefined) {
        record(
          `${scenario.name}: stop-timeout diagnostic`,
          Boolean(uiState.lastSave?.captureDiagnostics?.recorderStopTimedOut) === Boolean(scenario.expect.stopTimedOut),
          JSON.stringify(summary)
        );
      }
      if (scenario.expect.pending) {
        record(`${scenario.name}: UI shows pending audio state`, uiState.hasPending && uiState.hasAudioCaptured && !uiState.hasNotSaved, JSON.stringify(summary));
      }
    }

    const filteredConsoleErrors = consoleErrors.filter((text) => !/favicon.ico|Failed to load resource/i.test(text));
    record(`${scenario.name}: no page exceptions`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" || "));
    record(`${scenario.name}: no relevant console errors`, filteredConsoleErrors.length === 0, filteredConsoleErrors.slice(0, 5).join(" || "));
  } finally {
    await context.close();
  }
};

let browser;
try {
  browser = await chromium.launch({ headless: !headed });
  for (const scenario of scenarios) {
    await runScenario(browser, scenario);
  }

  console.log("\nSUMMARY");
  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ total: results.length, failed: failed.length, failedTests: failed }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error("FATAL", error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
