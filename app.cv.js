import { state, getDb, doc, getDoc, escapeHtml } from "./app.core.js";
import {
  MASTER_CV_SCHEMA,
  getDefaultBaseCvSections,
  getCvSectionDefs,
  buildResolvedCvModel,
  getResolvedCvSections,
} from "./app.cv.schema.js";

const normalizeBullet = (text) => String(text || "").replace(/^[\-•\s]*/, "").trim();
const bulletText = (text) => `• ${normalizeBullet(text)}`;
const bulletHtml = (items = []) =>
  items
    .map(
      (item) =>
        `<div style="margin:0 0 3px 0;padding-left:14px;text-indent:-14px;line-height:1.35;">• ${escapeHtml(
          normalizeBullet(item)
        )}</div>`
    )
    .join("");

const sectionHeadingHtml = (title) =>
  `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:4px;color:#0f172a;">${escapeHtml(
    title
  )}</div>`;

state.baseCvSections = getDefaultBaseCvSections();

export const getCvSectionDefinitions = () => getCvSectionDefs();

export const renderPdfFromElement = async (element, options) => {
  if (typeof html2pdf === "undefined") {
    throw new Error("PDF library failed to load.");
  }
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:0;top:0;width:760px;background:#fff;z-index:99999;overflow:visible;pointer-events:none;";
  element.style.background = "#ffffff";
  host.appendChild(element);
  document.body.appendChild(host);
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  void host.offsetHeight;
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    const merged = {
      ...options,
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        ...(options.html2canvas || {}),
      },
    };
    await html2pdf().set(merged).from(element).save();
  } finally {
    host.remove();
  }
};

export const loadBaseCvFromFirestore = async () => {
  if (!getDb()) return;
  try {
    const snap = await getDoc(doc(getDb(), "cv_settings", "base_cv"));
    if (snap.exists()) {
      const data = snap.data() || {};
      const defaults = getDefaultBaseCvSections();
      state.baseCvSections = {
        ...defaults,
        ...data,
      };
    } else {
      state.baseCvSections = getDefaultBaseCvSections();
    }
  } catch (err) {
    console.error("Failed to load base CV from Firestore:", err);
    state.baseCvSections = getDefaultBaseCvSections();
  }
};

export const hasCvTailoredChanges = (job) => {
  const tailored = getResolvedCvSections({ baseSections: state.baseCvSections, tailoredSections: job?.tailored_cv_sections || {} });
  const base = getResolvedCvSections({ baseSections: state.baseCvSections, tailoredSections: {} });
  return getCvSectionDefs().some((section) => {
    const tailoredValue = tailored[section.key];
    const baseValue = base[section.key];
    return JSON.stringify(tailoredValue) !== JSON.stringify(baseValue);
  });
};

const buildPlainTextFromModel = (model) => {
  const lines = [];
  const header = model.header;

  lines.push(header.full_name.toUpperCase());
  lines.push(`${header.location} | ${header.phone} | ${header.email} | ${header.linkedin_url}`);
  lines.push(`Portfolio: ${header.portfolio_items.join(" | ")}`);
  lines.push("");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(model.summary);
  lines.push("");
  lines.push("KEY ACHIEVEMENTS");
  model.key_achievements.forEach((item) => lines.push(bulletText(item)));
  lines.push("");
  lines.push("PROFESSIONAL EXPERIENCE");

  model.experience.forEach((entry) => {
    lines.push("");
    lines.push(`${entry.company_line} | ${entry.title}`);
    lines.push(entry.date_range);
    lines.push(entry.role_summary);
    entry.bullets.forEach((item) => lines.push(bulletText(item)));
  });

  lines.push("");
  lines.push("PREVIOUS EXPERIENCE");
  model.previous_experience.forEach((item) => lines.push(bulletText(item)));
  lines.push("");
  lines.push("CORE COMPETENCIES");
  model.competencies.forEach((entry) => lines.push(`${entry.label}: ${entry.items.join(", ")}`));
  lines.push("");
  lines.push("EDUCATION & CERTIFICATIONS");
  model.education.forEach((item) => lines.push(item));
  lines.push(model.certifications.join(" | "));
  model.governance.forEach((item) => lines.push(item));

  return lines.join("\n");
};

export const getTailoredCvPlainText = (job = {}) => {
  const model = buildResolvedCvModel({
    baseSections: state.baseCvSections,
    tailoredSections: job.tailored_cv_sections || {},
  });
  return buildPlainTextFromModel(model);
};

export const buildTailoredCvHtml = (job = {}) => {
  const model = buildResolvedCvModel({
    baseSections: state.baseCvSections,
    tailoredSections: job.tailored_cv_sections || {},
  });
  const container = document.createElement("div");
  const header = model.header;
  const competenciesHtml = model.competencies
    .map(
      (entry) =>
        `<div style="margin-bottom:2px;"><strong>${escapeHtml(entry.label)}:</strong> ${escapeHtml(entry.items.join(", "))}</div>`
    )
    .join("");

  const experienceHtml = model.experience
    .map(
      (entry) => `
        <div style="margin-bottom:6px;page-break-inside:avoid;break-inside:avoid;">
          <div style="margin-bottom:1px;"><strong style="font-size:11px;">${escapeHtml(entry.company_line)}</strong></div>
          <div style="font-size:11px;color:#475569;margin-bottom:1px;">${escapeHtml(entry.title)} | ${escapeHtml(entry.date_range)}</div>
          <div style="font-size:10.5px;margin-bottom:3px;color:#334155;">${escapeHtml(entry.role_summary)}</div>
          ${bulletHtml(entry.bullets)}
        </div>`
    )
    .join("");

  container.innerHTML = `
    <div style="font-family:Helvetica,Arial,sans-serif;color:#1f2937;padding:0 20px;margin:0;width:680px;box-sizing:border-box;font-size:11px;line-height:1.3;font-variant-ligatures:none;font-feature-settings:'liga' 0,'clig' 0;">
      <div style="text-align:center;margin-bottom:6px;">
        <div style="font-size:21px;font-weight:700;letter-spacing:0.5px;color:#0f172a;margin-bottom:3px;">${escapeHtml(
          header.full_name.toUpperCase()
        )}</div>
        <div style="font-size:10px;color:#475569;">${escapeHtml(header.location)} &nbsp;|&nbsp; ${escapeHtml(
          header.phone
        )} &nbsp;|&nbsp; ${escapeHtml(header.email)} &nbsp;|&nbsp; ${escapeHtml(header.linkedin_url)}</div>
        <div style="font-size:10px;color:#0d9488;">Portfolio: ${escapeHtml(header.portfolio_items.join(" | "))}</div>
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeadingHtml("Professional Summary")}
        <div style="font-size:11px;line-height:1.35;">${escapeHtml(model.summary)}</div>
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeadingHtml("Key Achievements")}
        ${bulletHtml(model.key_achievements)}
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeadingHtml("Professional Experience")}
        ${experienceHtml}
      </div>

      <div style="margin-bottom:5px;page-break-inside:avoid;break-inside:avoid;">
        ${sectionHeadingHtml("Previous Experience")}
        ${bulletHtml(model.previous_experience)}
      </div>

      <div style="margin-bottom:5px;page-break-inside:avoid;break-inside:avoid;">
        ${sectionHeadingHtml("Core Competencies")}
        ${competenciesHtml}
      </div>

      <div style="page-break-inside:avoid;break-inside:avoid;">
        ${sectionHeadingHtml("Education & Certifications")}
        ${model.education.map((item) => `<div style="margin-bottom:2px;">${escapeHtml(item)}</div>`).join("")}
        <div style="margin-bottom:2px;">${escapeHtml(model.certifications.join(" | "))}</div>
        ${model.governance.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
      </div>
    </div>
  `;

  if (!container.firstElementChild) {
    const fallback = document.createElement("div");
    fallback.textContent = "CV template could not be generated.";
    return fallback;
  }
  return container.firstElementChild;
};

export { MASTER_CV_SCHEMA };
