import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { buildResolvedCvModel } from "../../app.cv.schema.js";

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
  const model = buildResolvedCvModel({ baseSections: baseCvSections, tailoredSections: sections });
  const competencies = model.competencies
    .map((entry) => `<div style="margin-bottom:2px;"><strong>${safe(entry.label)}:</strong> ${safe(entry.items.join(", "))}</div>`)
    .join("");
  const experienceHtml = model.experience
    .map(
      (entry) => `
        <div style="margin-bottom:10px;">
          <div style="font-weight:700;color:#0f172a;">${safe(entry.company_line)}</div>
          <div style="font-size:10px;color:#475569;margin-bottom:3px;">${safe(entry.title)} | ${safe(entry.date_range)}</div>
          <div style="font-size:10px;color:#334155;margin-bottom:3px;">${safe(entry.role_summary)}</div>
          ${bulletHtml(entry.bullets)}
        </div>`
    )
    .join("");
  return `
    <html>
      <body style="font-family:Helvetica,Arial,sans-serif;color:#1f2937;padding:28px 36px;font-size:11px;line-height:1.35;font-variant-ligatures:none;font-feature-settings:'liga' 0,'clig' 0;">
        <div style="text-align:center;margin-bottom:10px;">
          <div style="font-size:22px;font-weight:700;color:#0f172a;">${safe(model.header.full_name || answers.fullName || "Candidate")}</div>
          <div style="font-size:10px;color:#475569;">${safe(model.header.location || answers.location || "")} | ${safe(
    model.header.phone || answers.phone || ""
  )} | ${safe(model.header.email || answers.email || "")} | ${safe(model.header.linkedin_url || answers.linkedinUrl || "")}</div>
          <div style="font-size:10px;color:#334155;">Portfolio: ${safe(model.header.portfolio_items.join(" | "))}</div>
          <div style="margin-top:6px;border-top:1px solid #cbd5e1;"></div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Professional Summary</div>
          <div>${safe(model.summary)}</div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Key Achievements</div>
          ${bulletHtml(model.key_achievements)}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Professional Experience</div>
          ${experienceHtml}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Previous Experience</div>
          ${bulletHtml(model.previous_experience)}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Core Competencies</div>
          ${competencies}
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #0f172a;margin-bottom:4px;">Education & Certifications</div>
          ${model.education.map((item) => `<div>${safe(item)}</div>`).join("")}
          <div style="margin-top:4px;">${safe(model.certifications.join(" | "))}</div>
          ${model.governance.map((item) => `<div>${safe(item)}</div>`).join("")}
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
