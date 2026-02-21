import { state, db, doc, getDoc, escapeHtml } from "./app.core.js";

export const renderPdfFromElement = async (element, options) => {
  if (typeof html2pdf === "undefined") {
    throw new Error("PDF library failed to load.");
  }
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "210mm";
  host.style.background = "#ffffff";
  host.style.pointerEvents = "none";
  host.style.zIndex = "9999";
  host.appendChild(element);
  document.body.appendChild(host);
  try {
    await html2pdf().set(options).from(element).save();
  } finally {
    host.remove();
  }
};

const BASE_CV_SECTIONS = {
  summary: "13+ years in financial crime product and operations management, delivering onboarding and screening platform transformations across EMEA, AMER and APAC. Independently created and deployed three live RegTech products used by compliance officers and regulated firms. Led enterprise KYC and screening platform strategy and configuration (Fenergo, Napier, Enate) for thousands of business clients globally, designing scalable 1st line controls and operating models. Proven stakeholder manager from front office to C-suite.",
  key_achievements: [
    "55% reduction in client onboarding time (45 days → 20 days) across EMEA, AMER and APAC",
    "20% operational headcount efficiency through workflow automation",
    "18+ reporting dashboards deployed, used by hundreds of users across APAC and EMEA",
    "3 live RegTech products independently created and deployed using AI-assisted development",
    "Napier screening implementation was subsequently validated by Dutch DNB effectiveness assessment",
    "12 BaFin audit points closed, mitigating multimillion-pound fine exposure",
    "£120k ARR secured from Tier 1 global bank proof of concept",
  ],
  vistra_bullets: [
    "Led 1st line design and implementation of business onboarding and financial crime controls for corporate and fund clients, using Fenergo (KYC), Napier (screening) and Enate (orchestration) across EMEA, AMER and APAC",
    "Defined platform feature requirements and competitor positioning; secured £400k+ business case sign-off",
    "Led vendor evaluation and pricing negotiation, balancing regulatory and commercial constraints",
    "Defined Fenergo KYC product model across EMEA, AMER and APAC — global consistency with jurisdiction-specific CDD/EDD logic",
    "Owned Napier screening design and capacity framework; validated by Dutch DNB effectiveness assessment",
    "Created Enate orchestration layer from fragmented processes — 55% faster onboarding (45 → 20 days), thousands of clients annually",
    "Gathered requirements and built Power BI suite (screening, KYC, onboarding dashboards) through direct discovery with APAC, AMER and EMEA teams",
    "Managed 4 Business Analysts (reporting, data migration, SOPs, tech implementation); coordinated delivery across engineering, compliance, and front office",
    "Chaired SteerCo with CFO/COO; delivered QA academy for 150+ analysts across 20 countries",
  ],
  ebury_bullets: [
    "Built onboarding funnel analytics, identifying drop-off points; drove 20% conversion uplift across Spain, Greece and Germany",
    "Optimised screening thresholds - 38% false positive reduction, regulatory standards maintained",
    "Led Salesforce to Fenergo migration (50k+ client records): data quality strategy, vendor management, zero-downtime cutover",
    "Designed continuous monitoring for medium/low-risk segments — 60% reduction in client review touchpoints",
  ],
};

state.baseCvSections = { ...BASE_CV_SECTIONS };

export const loadBaseCvFromFirestore = async () => {
  if (!db) return;
  try {
    const snap = await getDoc(doc(db, "cv_settings", "base_cv"));
    if (snap.exists()) {
      const data = snap.data();
      const keys = ["summary", "key_achievements", "vistra_bullets", "ebury_bullets"];
      for (const key of keys) {
        if (data[key] !== undefined) state.baseCvSections[key] = data[key];
      }
    }
  } catch (err) {
    console.error("Failed to load base CV from Firestore:", err);
  }
};

export const getTailoredCvPlainText = (job) => {
  const sections = job.tailored_cv_sections || {};
  const base = state.baseCvSections;
  const lines = [];
  lines.push("ADE OMOSANYA");
  lines.push("London, UK | ademolaomosanya@gmail.com | linkedin.com/in/adeomosanya | omosanya.com\n");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push((sections.summary || base.summary) + "\n");
  lines.push("KEY ACHIEVEMENTS");
  (sections.key_achievements || base.key_achievements).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nPROFESSIONAL EXPERIENCE");
  lines.push("\nVistra Corporate Services | Senior Product Manager | September 2023 - Present");
  (sections.vistra_bullets || base.vistra_bullets).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nEbury Partners | Product Manager | April 2022 - September 2023");
  (sections.ebury_bullets || base.ebury_bullets).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nMEMA Consultants | Founder & Director | March 2017 - Present");
  lines.push("- Built and launched MEMA compliance analytics suite (vulnerability, FCA fines, financial promotions, FOS dashboards) using Next.js and AI tooling — 10+ enterprise clients, hundreds of monthly users");
  lines.push("- Scaled consultancy to 25+ clients through targeted FCA register outreach, delivering audits and remediation plans");
  lines.push("- Leveraged full product lifecycle experience to validate and scale RegTech solutions");
  lines.push("\nElucidate | Product Manager | September 2020 - March 2022");
  lines.push("- Secured £120k ARR over three years through successful POC with global bank");
  lines.push("- Conducted usability studies driving platform redesign: 35% activity increase, 40% MAU boost");
  lines.push("- Reduced client deployment timeline from 10 to 6 weeks through requirements optimisation");
  lines.push("- Led cross-functional team of engineers, data scientists, and UX designers");
  lines.push("\nN26 | Financial Crime Product Lead | September 2019 - 2020");
  lines.push("- Designed control framework adopted by 100+ FC department staff");
  lines.push("- Led FC transformation project (team of 8) achieving 12 audit point approvals");
  lines.push("- Established EDD review team, remediated 470 PEPs backlog");
  lines.push("\nErnst & Young | Senior Associate, Financial Crime Advisory | February 2017 - August 2019");
  lines.push("- Implemented KYC QA framework for transformation program (Netherlands)");
  lines.push("- Co-led Skilled Person Review of Group Risk Assessment (AML/ABC/Sanctions)");
  lines.push("\nMazars | Assistant Manager, Financial Services Consulting | August 2015 - February 2017");
  lines.push("\nFinancial Conduct Authority | Associate, Authorisations | February 2014 - August 2015");
  lines.push("\nFinancial Ombudsman Service | Investment Adjudicator | April 2012 - February 2014");
  lines.push("\nTECHNICAL & PRODUCT CAPABILITIES");
  lines.push("Platforms: Fenergo CLM, Enate Orchestration, Napier Screening, LexisNexis Bridger, Jumio, Power BI");
  lines.push("Product: OKR/KPI Frameworks, A/B Testing, Customer Journey Mapping, Agile/Scrum, JIRA");
  lines.push("Regulatory: KYC/KYB Transformation, AML Program Design, Financial Crime Risk, ACAMS, ICA Fellow");
  lines.push("\nEDUCATION & CERTIFICATIONS");
  lines.push("LLB Law | University of Hull (2007-2010)");
  lines.push("ACAMS Certified | ICA Fellow");
  return lines.join("\n");
};

export const buildTailoredCvHtml = (job) => {
  const s = job.tailored_cv_sections || {};
  const base = state.baseCvSections;
  const summary = s.summary || base.summary;
  const achievements = s.key_achievements || base.key_achievements;
  const vistraBullets = s.vistra_bullets || base.vistra_bullets;
  const eburyBullets = s.ebury_bullets || base.ebury_bullets;

  const esc = (t) => escapeHtml(String(t));
  const bulletHtml = (items) =>
    items
      .map(
        (b) =>
          `<div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">- ${esc(
            b.replace(/^[-\s]*/, "")
          )}</div>`
      )
      .join("");

  const sectionHeading = (title) =>
    `<div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:4px;color:#0f172a;">${title}</div>`;

  const roleHeader = (company, dates) =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px;"><span style="font-weight:700;font-size:8.5pt;">${esc(company)}</span><span style="font-size:7.5pt;color:#475569;">${esc(dates)}</span></div>`;

  const roleTitle = (title) =>
    `<div style="font-style:italic;font-size:8pt;color:#475569;margin-bottom:2px;">${esc(title)}</div>`;

  const compactRole = (company, title, dates) =>
    `<div style="margin-bottom:3px;"><div style="display:flex;justify-content:space-between;align-items:baseline;"><span style="font-weight:700;font-size:8.5pt;">${esc(company)}</span><span style="font-size:7.5pt;color:#475569;">${esc(dates)}</span></div><div style="font-style:italic;font-size:8pt;color:#475569;">${esc(title)}</div></div>`;

  const container = document.createElement("div");
  container.innerHTML = `
    <div style="font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:8.5pt;line-height:1.3;">
      <div style="text-align:center;margin-bottom:6px;">
        <div style="font-size:16pt;font-weight:700;letter-spacing:0.5px;color:#0f172a;margin-bottom:3px;">ADE OMOSANYA</div>
        <div style="font-size:7.5pt;color:#475569;">London, UK &nbsp;|&nbsp; ademolaomosanya@gmail.com &nbsp;|&nbsp; linkedin.com/in/adeomosanya &nbsp;|&nbsp; omosanya.com</div>
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeading("Professional Summary")}
        <div style="font-size:8.5pt;line-height:1.35;">${esc(summary)}</div>
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeading("Key Achievements")}
        ${bulletHtml(achievements)}
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeading("Professional Experience")}

        <div style="margin-bottom:5px;">
          ${roleHeader("Vistra Corporate Services", "September 2023 - Present")}
          ${roleTitle("Senior Product Manager")}
          ${bulletHtml(vistraBullets)}
        </div>

        <div style="margin-bottom:5px;">
          ${roleHeader("Ebury Partners", "April 2022 - September 2023")}
          ${roleTitle("Product Manager")}
          ${bulletHtml(eburyBullets)}
        </div>

        <div style="margin-bottom:5px;">
          ${roleHeader("MEMA Consultants", "March 2017 - Present")}
          ${roleTitle("Founder & Director")}
          ${bulletHtml([
            "Built and launched MEMA compliance analytics suite (vulnerability, FCA fines, financial promotions, FOS dashboards) using Next.js and AI tooling — 10+ enterprise clients, hundreds of monthly users",
            "Scaled consultancy to 25+ clients through targeted FCA register outreach, delivering audits and remediation plans",
            "Leveraged full product lifecycle experience to validate and scale RegTech solutions",
          ])}
        </div>

        <div style="margin-bottom:5px;">
          ${roleHeader("Elucidate", "September 2020 - March 2022")}
          ${roleTitle("Product Manager")}
          ${bulletHtml([
            "Secured £120k ARR over three years through successful POC with global bank",
            "Conducted usability studies driving platform redesign: 35% activity increase, 40% MAU boost",
            "Reduced client deployment timeline from 10 to 6 weeks through requirements optimisation",
            "Led cross-functional team of engineers, data scientists, and UX designers",
          ])}
        </div>

        <div style="margin-bottom:5px;">
          ${roleHeader("N26", "September 2019 - 2020")}
          ${roleTitle("Financial Crime Product Lead")}
          ${bulletHtml([
            "Designed control framework adopted by 100+ FC department staff",
            "Led FC transformation project (team of 8) achieving 12 audit point approvals",
            "Established EDD review team, remediated 470 PEPs backlog",
          ])}
        </div>

        <div style="margin-bottom:5px;">
          ${roleHeader("Ernst & Young", "February 2017 - August 2019")}
          ${roleTitle("Senior Associate, Financial Crime Advisory")}
          ${bulletHtml([
            "Implemented KYC QA framework for transformation program (Netherlands)",
            "Co-led Skilled Person Review of Group Risk Assessment (AML/ABC/Sanctions)",
          ])}
        </div>

        ${compactRole("Mazars", "Assistant Manager, Financial Services Consulting", "August 2015 - February 2017")}
        ${compactRole("Financial Conduct Authority", "Associate, Authorisations", "February 2014 - August 2015")}
        ${compactRole("Financial Ombudsman Service", "Investment Adjudicator", "April 2012 - February 2014")}
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeading("Technical & Product Capabilities")}
        <div style="margin-bottom:2px;"><strong>Platforms:</strong> Fenergo CLM, Enate Orchestration, Napier Screening, LexisNexis Bridger, Jumio, Power BI</div>
        <div style="margin-bottom:2px;"><strong>Product:</strong> OKR/KPI Frameworks, A/B Testing, Customer Journey Mapping, Agile/Scrum, JIRA</div>
        <div><strong>Regulatory:</strong> KYC/KYB Transformation, AML Program Design, Financial Crime Risk, ACAMS, ICA Fellow</div>
      </div>

      <div>
        ${sectionHeading("Education & Certifications")}
        <div style="margin-bottom:2px;"><strong>LLB Law</strong> — University of Hull (2007-2010)</div>
        <div><strong>ACAMS Certified</strong> | <strong>ICA Fellow</strong></div>
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
