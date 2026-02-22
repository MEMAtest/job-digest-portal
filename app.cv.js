import { state, getDb, doc, getDoc, escapeHtml } from "./app.core.js";

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
  summary: "Onboarding, KYC and screening product leader specialising in platform configuration, workflow orchestration and MI for regulated financial services. Built and shipped enterprise controls using Fenergo, Napier and Enate across EMEA, AMER and APAC, serving thousands of corporate and fund clients. Independently created and deployed three live RegTech products used by compliance officers and regulated firms. Known for writing SteerCo-ready packs, running deep-dive root cause sessions, and turning them into delivery plans with owners and dates.",
  key_achievements: [
    "Reduced client onboarding cycle time by 55% (45 to 20 days) across EMEA, AMER and APAC",
    "Drove 20% operational headcount efficiency through workflow automation and orchestration",
    "Deployed 18+ reporting dashboards used by hundreds of users across APAC and EMEA",
    "Built and shipped 3 live RegTech products (Next.js/React, AI-assisted) used by compliance officers and regulated SMEs",
    "Designed Napier screening framework subsequently validated by Dutch DNB effectiveness assessment",
    "Closed 12 BaFin audit points, mitigating multimillion-pound fine exposure",
    "Secured \u00a3120k ARR from Tier 1 global bank proof of concept",
  ],
  vistra_bullets: [
    "Led 1st line design and implementation of onboarding and financial crime controls for corporate and fund clients, using Fenergo (KYC), Napier (screening) and Enate (orchestration) across EMEA, AMER and APAC",
    "Defined platform feature requirements and competitor positioning; secured \u00a3400k+ business case sign-off",
    "Led vendor evaluation and pricing negotiation, balancing regulatory and commercial constraints",
    "Defined Fenergo KYC product model across three regions, delivering global consistency with jurisdiction-specific CDD/EDD logic",
    "Owned Napier screening design and capacity framework; configuration validated by Dutch DNB effectiveness assessment",
    "Created Enate orchestration layer from fragmented processes, eliminating the primary bottleneck in onboarding cycle time for thousands of clients annually",
    "Gathered requirements and built Power BI reporting suite across screening, KYC and onboarding through direct discovery with APAC, AMER and EMEA teams",
    "Managed 4 Business Analysts (reporting, data migration, SOPs, tech implementation); coordinated delivery across engineering, compliance, and front office",
    "Chaired SteerCo with CFO/COO; delivered QA academy for 150+ analysts across 20 countries",
  ],
  ebury_bullets: [
    "Built onboarding funnel analytics, identifying drop-off points; drove conversion uplift across Spain, Greece and Germany",
    "Optimised screening thresholds to cut false positives by 38%, maintaining regulatory standards",
    "Led Salesforce to Fenergo migration (50k+ client records): data quality strategy, vendor management, zero-downtime cutover",
    "Designed continuous monitoring for medium/low-risk segments, reducing client review touchpoints by 60%",
  ],
};

state.baseCvSections = { ...BASE_CV_SECTIONS };

export const loadBaseCvFromFirestore = async () => {
  if (!getDb()) return;
  try {
    const snap = await getDoc(doc(getDb(), "cv_settings", "base_cv"));
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

export const hasCvTailoredChanges = (job) => {
  if (!state.baseCvSections) return false;
  const tailored = job.tailored_cv_sections || {};
  const sections = ["summary", "key_achievements", "vistra_bullets", "ebury_bullets"];
  return sections.some((key) => {
    const tailoredVal = tailored[key];
    const baseVal = state.baseCvSections[key];
    if (!tailoredVal) return false;
    if (Array.isArray(tailoredVal)) {
      return JSON.stringify(tailoredVal) !== JSON.stringify(baseVal || []);
    }
    if (typeof tailoredVal === "string") {
      return tailoredVal.trim() !== String(baseVal || "").trim();
    }
    return false;
  });
};

export const getTailoredCvPlainText = (job) => {
  const sections = job.tailored_cv_sections || {};
  const base = state.baseCvSections;
  const bullet = (text) => `\u2022 ${text.replace(/^[\-\u2022\s]*/, "")}`;
  const lines = [];

  // Header
  lines.push("ADE OMOSANYA");
  lines.push("London, UK | 07920497486 | ademolaomosanya@gmail.com");
  lines.push("LinkedIn | Portfolio: FCA Fines Dashboard | Vulnerability Portal | SMCR Platform\n");

  // Professional Summary
  lines.push("PROFESSIONAL SUMMARY");
  lines.push((sections.summary || base.summary) + "\n");

  // Key Achievements
  lines.push("KEY ACHIEVEMENTS");
  (sections.key_achievements || base.key_achievements).forEach((b) => lines.push(bullet(b)));

  // Professional Experience
  lines.push("\nPROFESSIONAL EXPERIENCE");

  // Vistra
  lines.push("\nVISTRA | Global Corporate Services");
  lines.push("Global Product & Process Owner \u2013 Onboarding, KYC & Screening | September 2023 \u2013 Present");
  const vistraBullets = sections.vistra_bullets || base.vistra_bullets;
  vistraBullets.forEach((b) => lines.push(bullet(b)));

  // Ebury
  lines.push("\nEBURY | B2B Foreign Exchange Platform (Series E, \u00a31.7B valuation)");
  lines.push("Product Manager \u2013 Identity & Financial Crime | April 2022 \u2013 September 2023");
  (sections.ebury_bullets || base.ebury_bullets).forEach((b) => lines.push(bullet(b)));

  // MEMA Consultants
  lines.push("\nMEMA CONSULTANTS | RegTech & Compliance Solutions");
  lines.push("Founder & Director | March 2017 \u2013 Present");
  lines.push(bullet("Built and deployed 3 live RegTech products (Next.js/React, AI-assisted) used by compliance officers and regulated SMEs:"));
  lines.push("  FCA Fines Dashboard | Regulatory enforcement analytics");
  lines.push("  Vulnerability Portal | Consumer Duty compliance");
  lines.push("  SMCR Platform | Senior Managers regime mapping");
  lines.push(bullet("Advisory: FCA authorisation, financial crime framework design, horizon scanning tooling"));

  // Elucidate
  lines.push("\nELUCIDATE | RegTech SaaS Platform");
  lines.push("Product Manager | September 2020 \u2013 March 2022");
  lines.push(bullet("Zero-to-one: discovery, solution design, PoC delivery; Tier 1 bank, \u00a3120k ARR"));
  lines.push(bullet("Post-PoC: built networking feature from customer discovery; 8 firms onboarded"));
  lines.push(bullet("Redesigned platform UX; 40% MAU uplift, deployment reduced to 6 weeks"));

  // N26
  lines.push("\nN26 | Digital Banking (7M+ customers)");
  lines.push("Financial Crime Product Lead | September 2019 \u2013 September 2020");
  lines.push(bullet("Led remediation programme addressing BaFin regulatory concerns; defined product requirements across transaction monitoring, screening, and enhanced due diligence"));
  lines.push(bullet("Established EDD squad; cleared 470 PEP backlog and automated 70% of review processes"));

  // Previous Experience
  lines.push("\nPrevious Experience");
  lines.push(bullet("ERNST & YOUNG \u2013 Senior Associate, Financial Crime Advisory (2017\u20132019)"));
  lines.push(bullet("MAZARS \u2013 Assistant Manager, Financial Services Consulting (2015\u20132017)"));
  lines.push(bullet("FINANCIAL CONDUCT AUTHORITY \u2013 Associate, Authorisations (2014\u20132015)"));
  lines.push(bullet("FINANCIAL OMBUDSMAN SERVICE \u2013 Investment Adjudicator (2012\u20132014)"));

  // Technical & Product Capabilities
  lines.push("\nTECHNICAL & PRODUCT CAPABILITIES");
  lines.push("\u2022 Platforms- KYC: Fenergo | Sanctions & Screening: Napier, LexisNexis Bridger | Onboarding Orchestration: Enate | ID&V: Jumio, Onfido, IDnow | CRM: Salesforce");
  lines.push("\u2022 Technical- SQL, PostgreSQL | Power BI, Excel | Next.js/React, Vercel, Netlify, GitHub | API integration | Jira, Confluence | Figma, Miro");
  lines.push("\u2022 Product- Zero-to-one builds, discovery, roadmap ownership, business cases, competitor analysis, capacity planning, Kanban");
  lines.push("\u2022 Regulatory- UK FCA/MLR/JMLSG, EU- Dutch DNB, BaFin, Hong Kong SFC, Singapore MAS, OFAC/OFSI, EU AMLD");

  // Education
  lines.push("\nUniversity of Hull \u2013 LLB Law (2007\u20132010)");
  lines.push("ACAMS Certified (2018) | ICA Fellow (2020) | APCC Member");

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
          `<div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 ${esc(
            b.replace(/^[-\u2022\s]*/, "")
          )}</div>`
      )
      .join("");

  const sectionHeading = (title) =>
    `<div style="font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:4px;color:#0f172a;">${title}</div>`;

  const subHeading = (title) =>
    `<div style="font-weight:700;font-size:8pt;margin:4px 0 2px 0;color:#0f172a;">${esc(title)}</div>`;

  const container = document.createElement("div");
  container.innerHTML = `
    <div style="font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:8.5pt;line-height:1.3;">
      <div style="text-align:center;margin-bottom:6px;">
        <div style="font-size:16pt;font-weight:700;letter-spacing:0.5px;color:#0f172a;margin-bottom:3px;">ADE OMOSANYA</div>
        <div style="font-size:7.5pt;color:#475569;">London, UK &nbsp;|&nbsp; 07920497486 &nbsp;|&nbsp; ademolaomosanya@gmail.com</div>
        <div style="font-size:7.5pt;color:#0d9488;">LinkedIn &nbsp;|&nbsp; Portfolio: FCA Fines Dashboard &nbsp;|&nbsp; Vulnerability Portal &nbsp;|&nbsp; SMCR Platform</div>
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
          <div style="margin-bottom:1px;"><strong style="font-size:8.5pt;">VISTRA</strong> <span style="font-size:8.5pt;">| Global Corporate Services</span></div>
          <div style="font-size:8pt;color:#475569;margin-bottom:3px;">Global Product &amp; Process Owner \u2013 Onboarding, KYC &amp; Screening | September 2023 \u2013 Present</div>
          ${bulletHtml(vistraBullets)}
        </div>

        <div style="margin-bottom:5px;">
          <div style="margin-bottom:1px;"><strong style="font-size:8.5pt;">EBURY</strong> <span style="font-size:8.5pt;">| B2B Foreign Exchange Platform (Series E, \u00a31.7B valuation)</span></div>
          <div style="font-size:8pt;color:#475569;margin-bottom:3px;">Product Manager \u2013 Identity &amp; Financial Crime | April 2022 \u2013 September 2023</div>
          ${bulletHtml(eburyBullets)}
        </div>

        <div style="margin-bottom:5px;">
          <div style="margin-bottom:1px;"><strong style="font-size:8.5pt;">MEMA CONSULTANTS</strong> <span style="font-size:8.5pt;">| RegTech &amp; Compliance Solutions</span></div>
          <div style="font-size:8pt;color:#475569;margin-bottom:3px;">Founder &amp; Director | March 2017 \u2013 Present</div>
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 Built and deployed 3 live RegTech products (Next.js/React, AI-assisted) used by compliance officers and regulated SMEs:</div>
          <div style="padding-left:20px;margin-bottom:2px;line-height:1.3;font-size:8pt;">FCA Fines Dashboard | Regulatory enforcement analytics<br>Vulnerability Portal | Consumer Duty compliance<br>SMCR Platform | Senior Managers regime mapping</div>
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 Advisory: FCA authorisation, financial crime framework design, horizon scanning tooling</div>
        </div>

        <div style="margin-bottom:5px;">
          <div style="margin-bottom:1px;"><strong style="font-size:8.5pt;">ELUCIDATE</strong> <span style="font-size:8.5pt;">| RegTech SaaS Platform</span></div>
          <div style="font-size:8pt;color:#475569;margin-bottom:3px;">Product Manager | September 2020 \u2013 March 2022</div>
          ${bulletHtml([
            "Zero-to-one: discovery, solution design, PoC delivery; Tier 1 bank, \u00a3120k ARR",
            "Post-PoC: built networking feature from customer discovery; 8 firms onboarded",
            "Redesigned platform UX; 40% MAU uplift, deployment reduced to 6 weeks",
          ])}
        </div>

        <div style="margin-bottom:5px;">
          <div style="margin-bottom:1px;"><strong style="font-size:8.5pt;">N26</strong> <span style="font-size:8.5pt;">| Digital Banking (7M+ customers)</span></div>
          <div style="font-size:8pt;color:#475569;margin-bottom:3px;">Financial Crime Product Lead | September 2019 \u2013 September 2020</div>
          ${bulletHtml([
            "Led remediation programme addressing BaFin regulatory concerns; defined product requirements across transaction monitoring, screening, and enhanced due diligence",
            "Established EDD squad; cleared 470 PEP backlog and automated 70% of review processes",
          ])}
        </div>

        <div style="margin-bottom:5px;">
          ${subHeading("Previous Experience")}
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 <strong>ERNST &amp; YOUNG</strong> \u2013 Senior Associate, Financial Crime Advisory (2017\u20132019)</div>
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 <strong>MAZARS</strong> \u2013 Assistant Manager, Financial Services Consulting (2015\u20132017)</div>
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 <strong>FINANCIAL CONDUCT AUTHORITY</strong> \u2013 Associate, Authorisations (2014\u20132015)</div>
          <div style="margin:0 0 2px 0;padding-left:14px;text-indent:-14px;line-height:1.3;">\u2022 <strong>FINANCIAL OMBUDSMAN SERVICE</strong> \u2013 Investment Adjudicator (2012\u20132014)</div>
        </div>
      </div>

      <div style="margin-bottom:5px;">
        ${sectionHeading("Technical & Product Capabilities")}
        <div style="margin-bottom:2px;"><strong>Platforms-</strong> KYC: Fenergo | Sanctions &amp; Screening: Napier, LexisNexis Bridger | Onboarding Orchestration: Enate | ID&amp;V: Jumio, Onfido, IDnow | CRM: Salesforce</div>
        <div style="margin-bottom:2px;"><strong>Technical-</strong> SQL, PostgreSQL | Power BI, Excel | Next.js/React, Vercel, Netlify, GitHub | API integration | Jira, Confluence | Figma, Miro</div>
        <div style="margin-bottom:2px;"><strong>Product-</strong> Zero-to-one builds, discovery, roadmap ownership, business cases, competitor analysis, capacity planning, Kanban</div>
        <div><strong>Regulatory-</strong> UK FCA/MLR/JMLSG, EU- Dutch DNB, BaFin, Hong Kong SFC, Singapore MAS, OFAC/OFSI, EU AMLD</div>
      </div>

      <div>
        ${sectionHeading("Education")}
        <div style="margin-bottom:2px;">University of Hull \u2013 LLB Law (2007\u20132010)</div>
        <div>ACAMS Certified (2018) | ICA Fellow (2020) | APCC Member</div>
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
