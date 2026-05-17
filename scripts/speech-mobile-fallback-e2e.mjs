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

const results = [];
const consoleErrors = [];
const pageErrors = [];

const record = (name, ok, details = "") => {
  results.push({ name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
};

let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });

  await context.addInitScript(() => {
    window.localStorage.setItem("speechCoach.whisperEnabled", "false");
    window.localStorage.setItem("speechCoach.aiReviewEnabled", "false");
    window.__speechMobileFallbackTest = {
      uploads: 0,
      saves: [],
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
      }

      start() {
        this.state = "recording";
        setTimeout(() => this.emitChunk("start"), 100);
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        setTimeout(() => {
          this.emitChunk("stop");
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

    class FailingSpeechRecognition {
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
          if (typeof this.onerror === "function") this.onerror({ error: "no-speech" });
          if (typeof this.onend === "function") this.onend();
        }, 100);
      }

      stop() {
        setTimeout(() => {
          if (typeof this.onend === "function") this.onend();
        }, 0);
      }
    }

    window.SpeechRecognition = FailingSpeechRecognition;
    window.webkitSpeechRecognition = FailingSpeechRecognition;

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
          device: "playwright-mobile-fake-mic",
        };
        window.__speechMobileFallbackTest.saves.push(payload.session);
        return originalFetch(input, { ...init, body: JSON.stringify(payload) });
      }

      return originalFetch(input, init);
    };
  });

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  record("Landing page response", Boolean(response?.ok()), response ? String(response.status()) : "no response");

  await page.getByRole("button", { name: "Speech Coach" }).click();
  await page.waitForSelector('.tab-section[data-tab="speechcoach"]:not(.hidden)', { timeout: timeoutMs });
  record("Speech Coach opened", true);

  const whisperChecked = await page.locator("#speech-whisper-toggle").isChecked();
  const aiChecked = await page.locator("#speech-ai-review-toggle").isChecked();
  record("Heavy transcript/review work disabled for deterministic test", !whisperChecked && !aiChecked, `whisper=${whisperChecked} ai=${aiChecked}`);

  await page.getByRole("button", { name: "Start without read" }).click();
  await page.waitForFunction(() => /Recording/i.test(document.querySelector(".speech-status-line")?.textContent || ""), null, {
    timeout: timeoutMs,
  });
  record("Recording starts through mocked mobile mic", true);

  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForSelector(".speech-result", { timeout: timeoutMs });

  const uiState = await page.evaluate(() => {
    const text = document.body.innerText;
    const test = window.__speechMobileFallbackTest || {};
    return {
      hasPending: /Pending/i.test(text),
      hasAudioCaptured: /Audio captured/i.test(text),
      hasNotSaved: /Not saved/i.test(text),
      uploadCount: test.uploads || 0,
      saveCount: Array.isArray(test.saves) ? test.saves.length : 0,
      lastSave: Array.isArray(test.saves) ? test.saves.at(-1) : null,
      status: document.querySelector(".speech-status-line")?.textContent?.trim() || "",
      result: document.querySelector(".speech-result")?.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });

  record("UI shows Pending instead of discarded session", uiState.hasPending && uiState.hasAudioCaptured && !uiState.hasNotSaved, uiState.result);
  record("Browser audio upload path was exercised", uiState.uploadCount === 1, `uploads=${uiState.uploadCount}`);
  record("Browser save payload marks transcript pending", Boolean(uiState.lastSave?.transcriptPending), JSON.stringify(uiState.lastSave || {}));
  record("Browser save payload has empty transcript", uiState.lastSave?.transcript === "", `transcript=${JSON.stringify(uiState.lastSave?.transcript)}`);
  record("Browser save payload marks audio captured", Boolean(uiState.lastSave?.audioCaptured), JSON.stringify(uiState.lastSave || {}));

  const filteredConsoleErrors = consoleErrors.filter((text) => !/favicon.ico|Failed to load resource/i.test(text));
  record("No page exceptions", pageErrors.length === 0, pageErrors.slice(0, 3).join(" || "));
  record("No relevant console errors", filteredConsoleErrors.length === 0, filteredConsoleErrors.slice(0, 5).join(" || "));

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
