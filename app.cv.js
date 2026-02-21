import { state, db, doc, getDoc, escapeHtml } from "./app.core.js";

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
  lines.push("London, UK | ade@omosanya.com | linkedin.com/in/adeomosanya | omosanya.com\n");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push((sections.summary || base.summary) + "\n");
  lines.push("KEY ACHIEVEMENTS");
  (sections.key_achievements || base.key_achievements).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nPROFESSIONAL EXPERIENCE");
  lines.push("\nVistra Corporate Services | Senior Product Manager | 2022 - Present");
  (sections.vistra_bullets || base.vistra_bullets).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nEbury Partners | Product Manager | 2020 - 2022");
  (sections.ebury_bullets || base.ebury_bullets).forEach((b) => lines.push(b.startsWith("- ") ? b : `- ${b}`));
  lines.push("\nMEMA Consulting | Product Lead | 2018 - 2020");
  lines.push("- Led delivery of regtech SaaS platform for AML compliance");
  lines.push("- Managed product backlog and sprint planning for team of 8");
  lines.push("- Drove client onboarding reducing implementation time by 30%");
  lines.push("\nElucidate | Product Manager | 2017 - 2018");
  lines.push("- Owned financial crime risk rating product for banking clients");
  lines.push("- Shipped ML-powered risk scoring achieving 85% prediction accuracy");
  lines.push("\nN26 | Associate Product Manager | 2016 - 2017");
  lines.push("- Contributed to mobile banking onboarding flow serving 2M+ users");
  lines.push("- Ran A/B tests improving KYC completion rate by 18%");
  lines.push("\nPrevious Experience | Various Roles | 2014 - 2016");
  lines.push("- Business analyst and operations roles in financial services");
  lines.push("\nTECHNICAL & PRODUCT CAPABILITIES");
  lines.push("Product: Roadmapping, OKRs, RICE, Discovery, A/B Testing, Analytics");
  lines.push("Technical: SQL, Python, REST APIs, Jira, Confluence, Figma, Mixpanel, Amplitude");
  lines.push("Domain: KYC, AML, Onboarding, Sanctions Screening, Payments, Open Banking");
  lines.push("\nEDUCATION & CERTIFICATIONS");
  lines.push("BSc Economics | University of Nottingham");
  lines.push("ICA Certificate in Compliance | International Compliance Association");
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
          `<div style="margin:0 0 3px 0;padding-left:14px;text-indent:-14px;line-height:1.35;">- ${esc(
            b.replace(/^[-\s]*/, "")
          )}</div>`
      )
      .join("");

  const container = document.createElement("div");
  container.innerHTML = `
    <div style="font-family:'Inter',Helvetica,Arial,sans-serif;color:#1f2937;padding:0;margin:0;width:180mm;font-size:9.5pt;line-height:1.4;">
      <div style="text-align:center;margin-bottom:10px;">
        <div style="font-size:20pt;font-weight:700;letter-spacing:0.5px;color:#0f172a;margin-bottom:4px;">ADE OMOSANYA</div>
        <div style="font-size:8.5pt;color:#475569;">London, UK &nbsp;|&nbsp; ade@omosanya.com &nbsp;|&nbsp; linkedin.com/in/adeomosanya &nbsp;|&nbsp; omosanya.com</div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Professional Summary</div>
        <div style="font-size:9.5pt;line-height:1.45;">${esc(summary)}</div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Key Achievements</div>
        ${bulletHtml(achievements)}
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Professional Experience</div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Vistra Corporate Services</span>
            <span style="font-size:8.5pt;color:#475569;">2022 - Present</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Senior Product Manager</div>
          ${bulletHtml(vistraBullets)}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Ebury Partners</span>
            <span style="font-size:8.5pt;color:#475569;">2020 - 2022</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Manager</div>
          ${bulletHtml(eburyBullets)}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">MEMA Consulting</span>
            <span style="font-size:8.5pt;color:#475569;">2018 - 2020</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Lead</div>
          ${bulletHtml([
            "Led delivery of regtech SaaS platform for AML compliance",
            "Managed product backlog and sprint planning for team of 8",
            "Drove client onboarding reducing implementation time by 30%",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Elucidate</span>
            <span style="font-size:8.5pt;color:#475569;">2017 - 2018</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Product Manager</div>
          ${bulletHtml([
            "Owned financial crime risk rating product for banking clients",
            "Shipped ML-powered risk scoring achieving 85% prediction accuracy",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">N26</span>
            <span style="font-size:8.5pt;color:#475569;">2016 - 2017</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Associate Product Manager</div>
          ${bulletHtml([
            "Contributed to mobile banking onboarding flow serving 2M+ users",
            "Ran A/B tests improving KYC completion rate by 18%",
          ])}
        </div>

        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;">
            <span style="font-weight:700;font-size:9.5pt;">Previous Experience</span>
            <span style="font-size:8.5pt;color:#475569;">2014 - 2016</span>
          </div>
          <div style="font-style:italic;font-size:9pt;color:#475569;margin-bottom:3px;">Various Roles</div>
          ${bulletHtml(["Business analyst and operations roles in financial services"])}
        </div>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Technical & Product Capabilities</div>
        <div style="margin-bottom:2px;"><strong>Product:</strong> Roadmapping, OKRs, RICE, Discovery, A/B Testing, Analytics</div>
        <div style="margin-bottom:2px;"><strong>Technical:</strong> SQL, Python, REST APIs, Jira, Confluence, Figma, Mixpanel, Amplitude</div>
        <div><strong>Domain:</strong> KYC, AML, Onboarding, Sanctions Screening, Payments, Open Banking</div>
      </div>

      <div>
        <div style="font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-bottom:1.5px solid #0f172a;padding-bottom:2px;margin-bottom:5px;color:#0f172a;">Education & Certifications</div>
        <div style="margin-bottom:2px;"><strong>BSc Economics</strong> — University of Nottingham</div>
        <div><strong>ICA Certificate in Compliance</strong> — International Compliance Association</div>
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
