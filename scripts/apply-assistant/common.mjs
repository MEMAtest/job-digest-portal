import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";

const safe = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "job";

export const splitName = (fullName) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

export const getPackDirectory = (jobId) =>
  path.join(os.homedir(), "Documents", "job apps", "roles", "application-packs", slugify(jobId));

const bulletHtml = (items = []) =>
  items
    .map(
      (item) =>
        `<div style="margin:0 0 3px 0;padding-left:14px;text-indent:-14px;line-height:1.35;">• ${safe(
          String(item).replace(/^[-•\s]*/, "")
        )}</div>`
    )
    .join("");

export const buildCvHtml = ({ role, company, sections = {}, baseCvSections = {}, answers = {} }) => {
  const summary = sections.summary || baseCvSections.summary || "";
  const keyAchievements = sections.key_achievements || baseCvSections.key_achievements || [];
  const vistra = sections.vistra_bullets || baseCvSections.vistra_bullets || [];
  const ebury = sections.ebury_bullets || baseCvSections.ebury_bullets || [];

  return `
    <html>
      <body style="font-family:Helvetica,Arial,sans-serif;color:#1f2937;padding:28px 36px;font-size:11px;line-height:1.35;">
        <div style="text-align:center;margin-bottom:10px;">
          <div style="font-size:22px;font-weight:700;color:#0f172a;">${safe(answers.fullName || "Candidate")}</div>
          <div style="font-size:10px;color:#475569;">${safe(answers.location || "")} | ${safe(answers.phone || "")} | ${safe(
    answers.email || ""
  )}</div>
          <div style="font-size:10px;color:#334155;">${safe(answers.linkedinUrl || "")}${answers.portfolioUrl ? ` | ${safe(answers.portfolioUrl)}` : ""}</div>
          <div style="font-size:10px;color:#7c3aed;margin-top:6px;">Tailored for ${safe(role || "role")}${company ? ` at ${safe(company)}` : ""}</div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Professional Summary</div>
          <div>${safe(summary)}</div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Key Achievements</div>
          ${bulletHtml(keyAchievements)}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Vistra Experience</div>
          ${bulletHtml(vistra)}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Ebury Experience</div>
          ${bulletHtml(ebury)}
        </div>
      </body>
    </html>
  `;
};

export const writeApplicationPack = async ({ jobId, role, company, pack }) => {
  const dir = getPackDirectory(jobId);
  await fs.mkdir(dir, { recursive: true });

  const answersPath = path.join(dir, "answers.json");
  const htmlPath = path.join(dir, "cv.html");
  const pdfPath = path.join(dir, "cv.pdf");

  const cvHtml = buildCvHtml({
    role,
    company,
    sections: pack.tailoredCvSections,
    baseCvSections: pack.baseCvSections,
    answers: pack.answers,
  });

  await fs.writeFile(answersPath, JSON.stringify(pack.answers, null, 2), "utf8");
  await fs.writeFile(htmlPath, cvHtml, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(cvHtml, { waitUntil: "domcontentloaded" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return { dir, answersPath, htmlPath, pdfPath };
};
