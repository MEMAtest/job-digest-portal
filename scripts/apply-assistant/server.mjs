import http from "node:http";
import { chromium } from "playwright";
import { writeApplicationPack, slugify } from "./common.mjs";
import { runGreenhouseAdapter } from "./adapters/greenhouse.mjs";
import { runLeverAdapter } from "./adapters/lever.mjs";
import { runAshbyAdapter } from "./adapters/ashby.mjs";
import { runWorkableAdapter } from "./adapters/workable.mjs";

const PORT = Number(process.env.APPLY_ASSISTANT_PORT || 4319);
const sessions = new Map();

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
};

const resolveAdapter = (atsFamily, jobUrl) => {
  const family = String(atsFamily || "").toLowerCase();
  if (family === "greenhouse" || /greenhouse/i.test(jobUrl)) return runGreenhouseAdapter;
  if (family === "lever" || /lever/i.test(jobUrl)) return runLeverAdapter;
  if (family === "ashby" || /ashby/i.test(jobUrl)) return runAshbyAdapter;
  if (family === "workable" || /workable/i.test(jobUrl)) return runWorkableAdapter;
  return null;
};

const launchApplicationSession = async (payload) => {
  const { jobId, jobUrl, atsFamily, pack, role, company, autoSubmit = false } = payload;
  if (!jobId || !jobUrl || !pack?.answers) {
    throw new Error("Missing required job payload");
  }

  const adapter = resolveAdapter(atsFamily, jobUrl);
  if (!adapter) {
    throw new Error("Unsupported ATS family");
  }

  const files = await writeApplicationPack({ jobId, role, company, pack });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 980 } });
  const page = await context.newPage();
  await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

  const result = await adapter({
    page,
    answers: pack.answers,
    cvPdfPath: files.pdfPath,
    autoSubmit,
  });

  const sessionId = `${slugify(jobId)}-${Date.now()}`;
  sessions.set(sessionId, { browser, context, page, files, createdAt: new Date().toISOString() });

  return {
    success: true,
    sessionId,
    atsFamily,
    status: result.status,
    filled: result.filled || [],
    skipped: result.skipped || [],
    notes: [...(result.notes || []), `CV PDF saved to ${files.pdfPath}`],
    files,
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, sessions: sessions.size });
    return;
  }

  if (req.url === "/start-application" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const result = await launchApplicationSession({ ...payload, autoSubmit: false });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        status: "unsupported_or_blocked",
        error: error.message || "Failed to start application session",
      });
    }
    return;
  }

  if (req.url === "/submit-approved" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const result = await launchApplicationSession({ ...payload, autoSubmit: true });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        status: "submit_failed",
        error: error.message || "Failed to submit approved application",
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Apply Assistant listening on http://127.0.0.1:${PORT}`);
});
