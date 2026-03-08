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
const viewportWidth = Number.parseInt(parseArg("--width", "1440"), 10) || 1440;
const viewportHeight = Number.parseInt(parseArg("--height", "1200"), 10) || 1200;
const waitMs = Number.parseInt(parseArg("--wait-ms", "8000"), 10) || 8000;
const timeoutMs = Number.parseInt(parseArg("--timeout-ms", "20000"), 10) || 20000;
const headed = args.includes("--headed");

const results = [];
const consoleErrors = [];
const pageErrors = [];

const record = (name, ok, details = "") => {
  results.push({ name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
};

const assertText = (text) => typeof text === "string" && text.trim().length > 0;

let browser;

try {
  browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: viewportHeight },
  });

  page.setDefaultTimeout(timeoutMs);

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });

  const response = await page.goto(baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(timeoutMs, 30000),
  });
  record("Landing page response", Boolean(response?.ok()), response ? String(response.status()) : "no response");

  await page.waitForSelector("h1");
  const heading = (await page.locator("h1").first().textContent()) || "";
  record("App shell heading", /Daily Job Intelligence/i.test(heading), heading.trim());

  await page.waitForTimeout(waitMs);

  const summaryText = ((await page.locator("#summary-line").textContent()) || "").trim();
  record("Summary line rendered", assertText(summaryText) && !/Loading sources/i.test(summaryText), summaryText);

  const sourceRows = await page.locator("#source-stats .source-mix__row").count();
  record("Source mix rows visible on dashboard", sourceRows > 0, `rows=${sourceRows}`);

  const dashboardOverflow = await page.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    sourceStatsOverflow: (() => {
      const el = document.querySelector("#source-stats");
      return el ? el.scrollWidth - el.clientWidth : null;
    })(),
  }));
  record("Dashboard horizontal overflow bounded", dashboardOverflow.docOverflow <= 2, JSON.stringify(dashboardOverflow));

  await page.getByRole("button", { name: "Live Roles" }).click();
  await page.waitForTimeout(2500);
  const liveVisible = await page.locator('.tab-section[data-tab="live"]:not(.hidden)').count();
  record("Live Roles tab opens", liveVisible > 0, `visible=${liveVisible}`);

  const jobCount = await page.locator("#job-list .job-list-item").count();
  record("Live Roles list populated", jobCount > 0, `jobs=${jobCount}`);

  if (jobCount > 0) {
    await page.locator("#job-list .job-list-item").first().click();
    await page.waitForTimeout(1000);
    const detailTitle = ((await page.locator("#job-detail .job-detail-title").first().textContent()) || "").trim();
    record("Job detail renders", assertText(detailTitle), detailTitle);
  } else {
    record("Job detail renders", false, "no jobs available to select");
  }

  const liveOverflow = await page.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    jobDetailOverflow: (() => {
      const el = document.querySelector("#job-detail");
      return el ? el.scrollWidth - el.clientWidth : null;
    })(),
    jobListOverflow: (() => {
      const el = document.querySelector("#job-list");
      return el ? el.scrollWidth - el.clientWidth : null;
    })(),
  }));
  record("Live Roles horizontal overflow bounded", liveOverflow.docOverflow <= 2, JSON.stringify(liveOverflow));

  const triageButton = page.getByRole("button", { name: /Start triaging/i });
  if (await triageButton.count()) {
    await triageButton.click();
    await page.waitForSelector("#triage-overlay:not(.hidden)", { timeout: 10000 });
    const triagePos = await page.evaluate(() => {
      const overlay = document.querySelector("#triage-overlay");
      const content = document.querySelector("#triage-content");
      const card = document.querySelector(".triage-card, .triage-summary");
      return {
        overlayVisible: Boolean(overlay) && !overlay.classList.contains("hidden"),
        overlayPos: overlay
          ? {
              top: Math.round(overlay.getBoundingClientRect().top),
              position: getComputedStyle(overlay).position,
            }
          : null,
        contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
        cardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
      };
    });
    record(
      "Triage overlay opens near top",
      triagePos.overlayVisible && triagePos.cardTop !== null && triagePos.cardTop < 220,
      JSON.stringify(triagePos)
    );
    await page.locator("#triage-close").click();
    await page.waitForTimeout(500);
  } else {
    record("Triage overlay opens near top", false, "triage button not present");
  }

  await page.getByRole("button", { name: "Application Hub" }).click();
  await page.waitForTimeout(1500);
  const applyVisible = await page.locator('.tab-section[data-tab="top"]:not(.hidden)').count();
  record("Application Hub tab opens", applyVisible > 0, `visible=${applyVisible}`);

  const applyOverflow = await page.evaluate(() => ({
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    hubOverflow: (() => {
      const el = document.querySelector("#apply-hub");
      return el ? el.scrollWidth - el.clientWidth : null;
    })(),
  }));
  record("Application Hub horizontal overflow bounded", applyOverflow.docOverflow <= 2, JSON.stringify(applyOverflow));

  await page.getByRole("button", { name: "Preparation" }).click();
  await page.waitForTimeout(1500);
  const prepVisible = await page.locator('.tab-section[data-tab="prep"]:not(.hidden)').count();
  record("Preparation tab opens", prepVisible > 0, `visible=${prepVisible}`);
  const prepCards = await page.locator("#prep-card-list > *").count();
  record("Preparation content present", prepCards > 0, `cards=${prepCards}`);

  const filteredConsoleErrors = consoleErrors.filter((text) => !/favicon.ico/i.test(text));
  record("No page exceptions", pageErrors.length === 0, pageErrors.slice(0, 3).join(" || "));
  record("No console errors", filteredConsoleErrors.length === 0, filteredConsoleErrors.slice(0, 5).join(" || "));

  console.log("\nSUMMARY");
  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ total: results.length, failed: failed.length, failedTests: failed }, null, 2));

  if (failed.length) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("FATAL", error);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}
