import { state, db, doc, getDoc, escapeHtml } from "./app.core.js";

const BASE_CV_SECTIONS = {
  summary: "Senior Product Manager with 8+ years across financial services, regtech and fintech. Specialist in onboarding, KYC/AML, and platform product strategy.",
  key_achievements: [
    "Led digital onboarding transformation serving 3M+ customers, reducing drop-off by 35%",
    "Delivered KYC remediation platform processing 500K+ cases across 6 jurisdictions",
    "Drove API-first integration strategy connecting 15+ downstream systems",
    "Shipped sanctions screening product reducing false positives by 40%",
    "Built product analytics framework improving feature adoption by 25%",
  ],
  vistra_bullets: [
    "Own end-to-end onboarding and KYC product suite across 6 EMEA jurisdictions",
    "Led platform migration reducing onboarding time from 21 to 7 days",
    "Managed cross-functional team of 12 engineers and 3 designers",
    "Delivered API integration layer connecting to 15+ compliance data providers",
    "Shipped automated risk scoring reducing manual review by 60%",
    "Drove product discovery and roadmap prioritisation using RICE framework",
    "Established product analytics with Mixpanel tracking 50+ key events",
    "Led regulatory change programme for EU AML 6th Directive compliance",
  ],
  ebury_bullets: [
    "Owned client onboarding and KYB product for FX/payments platform",
    "Reduced onboarding cycle time by 45% through workflow automation",
    "Shipped API-first partner integration used by 200+ intermediaries",
    "Led cross-border payments compliance product across 20+ currencies",
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
