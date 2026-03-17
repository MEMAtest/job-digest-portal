import fs from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isBlockedText(text) {
  const lowered = normalizeText(text).toLowerCase();
  return [
    "security check",
    "additional verification required",
    "verify you are a human",
    "captcha",
    "access to this page has been denied",
    "robot or human",
  ].some((token) => lowered.includes(token));
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return "";
  }
}

async function loadPayload() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Missing input payload path");
  }
  const raw = await fs.readFile(inputPath, "utf8");
  return JSON.parse(raw);
}

async function extractJobs(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const seen = new Set();
    const jobs = [];
    const anchors = Array.from(
      document.querySelectorAll(
        'a[href*="/viewjob"], a[href*="/rc/clk"], a[href*="jk="], a[data-jk], a.jcs-JobTitle'
      )
    );
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      const link = (() => {
        try {
          return new URL(href, location.origin).toString().split("#")[0];
        } catch {
          return "";
        }
      })();
      if (!link || seen.has(link)) {
        continue;
      }
      seen.add(link);

      const card =
        anchor.closest('[data-testid="slider_item"]') ||
        anchor.closest(".job_seen_beacon") ||
        anchor.closest(".cardOutline") ||
        anchor.closest("article") ||
        anchor.closest("li") ||
        anchor.closest("td.resultContent") ||
        anchor.parentElement;
      const textBlob = normalize(card?.textContent || anchor.textContent || "");

      const title =
        normalize(anchor.getAttribute("aria-label")) ||
        normalize(anchor.textContent) ||
        normalize(card?.querySelector("h2, h3")?.textContent || "");
      if (!title || title.length < 4) {
        continue;
      }

      const company =
        normalize(card?.querySelector('[data-testid="company-name"]')?.textContent || "") ||
        normalize(card?.querySelector(".companyName")?.textContent || "") ||
        normalize(card?.querySelector("span.companyName")?.textContent || "");

      const location =
        normalize(card?.querySelector('[data-testid="text-location"]')?.textContent || "") ||
        normalize(card?.querySelector(".companyLocation")?.textContent || "");

      const postedText =
        normalize(card?.querySelector(".date")?.textContent || "") ||
        normalize(card?.querySelector('[data-testid="myJobsStateDate"]')?.textContent || "") ||
        normalize(textBlob.match(/(\d+\s+(minutes?|hours?|days?)\s+ago|today|yesterday|new)/i)?.[0] || "");

      const summary =
        normalize(card?.querySelector(".job-snippet")?.textContent || "") ||
        normalize(card?.querySelector('[data-testid="job-snippet"]')?.textContent || "") ||
        textBlob.slice(0, 350);

      jobs.push({ title, company, location, link, posted_text: postedText, posted_date: "", summary });
    }
    return jobs;
  });
}

async function main() {
  const payload = await loadPayload();
  const {
    baseUrl = "https://uk.indeed.com",
    queries = [],
    pageLimit = 1,
    timeoutMs = 60000,
    headless = true,
    proxyUrl = "",
    userAgent = "",
  } = payload;

  const launchOptions = { headless };
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: userAgent || undefined,
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: { width: 1440, height: 1200 },
  });

  const jobsByLink = new Map();
  let blockedPages = 0;
  let attemptedQueries = 0;

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    for (const query of queries) {
      attemptedQueries += 1;
      for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
        const start = pageIndex * 10;
        const targetUrl = `${baseUrl.replace(/\/$/, "")}/jobs?q=${encodeURIComponent(query.q || "")}&l=${encodeURIComponent(query.l || "United Kingdom")}&sort=date&fromage=7${start ? `&start=${start}` : ""}`;
        try {
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          await page.waitForTimeout(1200);
        } catch {
          continue;
        }

        const pageText = normalizeText(await page.textContent("body").catch(() => ""));
        if (isBlockedText(pageText)) {
          blockedPages += 1;
          break;
        }

        const jobs = await extractJobs(page);
        for (const job of jobs) {
          if (!job.link) {
            continue;
          }
          const normalized = {
            ...job,
            link: toAbsoluteUrl(job.link, baseUrl),
            location: normalizeText(job.location) || normalizeText(query.l) || "United Kingdom",
            company: normalizeText(job.company) || "Indeed",
            title: normalizeText(job.title),
            summary: normalizeText(job.summary),
            posted_text: normalizeText(job.posted_text),
            posted_date: normalizeText(job.posted_date),
          };
          if (!normalized.link || !normalized.title) {
            continue;
          }
          if (!jobsByLink.has(normalized.link)) {
            jobsByLink.set(normalized.link, normalized);
          }
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  process.stdout.write(
    JSON.stringify({
      jobs: Array.from(jobsByLink.values()),
      blockedPages,
      attemptedQueries,
    })
  );
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error || ""));
  process.exit(1);
});
