const MASTER_CV_VERSION = "v11";

const MASTER_CV_SCHEMA = Object.freeze({
  version: MASTER_CV_VERSION,
  source_pdf_path: "/Users/adeomosanya/Downloads/Ade_Omosanya_CV_Master_Product_v11.pdf",
  header: {
    full_name: "Ade Omosanya",
    location: "London, UK",
    phone: "07920 497 486",
    email: "ademolaomosanya@gmail.com",
    linkedin_url: "linkedin.com/in/adeomosanya",
    portfolio_items: ["FCA Fines Dashboard", "Vulnerability Portal", "SMCR Platform"],
  },
  summary:
    "Senior Product Manager across B2B SaaS, fintech and digital banking platforms focused on onboarding, identity, KYC, screening and financial crime. Owns backlogs, requirements and sprint delivery with engineering, with direct API integration experience across Fenergo, Napier, LexisNexis, Jumio, POSTIDENT, Intelli-corp, Salesforce and the Elucidate platform API. Led platform, workflow and data-model changes across Vistra, Ebury, Elucidate and N26 spanning 30+ jurisdictions, enterprise client onboarding and regulatory remediation. Independently shipped three live RegTech products using scraping, data pipelines and AI-assisted workflows.",
  key_achievements: [
    "Standardised onboarding, KYC and screening across 30+ jurisdictions by defining one global product model across Enate, Fenergo and Napier (Vistra)",
    "Reduced onboarding cycle time by 20% and client outreach touchpoints by 30% through journey redesign, improved data capture and review-trigger changes (Vistra)",
    "Delivered 20% onboarding conversion uplift and 38% fewer unnecessary screening reviews across Spain, Greece and Germany by optimising ID&V and screening flows (Ebury)",
    "Secured a £120k ARR global bank PoC by taking a correspondent banking risk platform from zero-to-one discovery through enterprise API onboarding (Elucidate)",
    "Grew MEMA to 25+ clients and shipped three live RegTech products by turning recurring compliance problems into subscription products (MEMA)",
  ],
  experience: [
    {
      id: "vistra",
      company: "Vistra",
      company_line: "Vistra",
      title: "Global Product & Process Owner, Onboarding, KYC & Screening",
      date_range: "Sep 2023 – Present",
      role_summary:
        "Owns onboarding, KYC and screening product design across 30+ jurisdictions, using Enate, Fenergo and Napier across EMEA, AMER and APAC and aligning 50+ stakeholders",
      bullets: [
        "Owned backlog, user stories and sprint delivery across onboarding, KYC and screening with engineering; managed scope trade-offs across concurrent workstreams",
        "Defined API and data requirements across Fenergo, Napier, Power BI and Microsoft Fabric, including field mapping, payload structure, error handling and reporting outputs",
        "Replaced fragmented local workflows with one global product model by standardising target-state journeys, vendor decisions and hand-offs across Enate, Fenergo and Napier",
        "Designed Fenergo CLM journeys spanning entity and service capture, risk assessment, document collection, client outreach and approval routing across jurisdiction-specific CDD and EDD requirements",
        "Defined Napier screening configuration across jurisdictions, covering threshold tuning, QA sampling, case-handling rules and team-capacity planning",
        "Designed Enate orchestration workflows with vendor engineering to control when cases moved between onboarding, KYC and screening stages",
        "Led UAT, training and hypercare for Hong Kong and Singapore go-lives, supporting 150 analysts across 20+ countries",
      ],
      tailorable: true,
    },
    {
      id: "ebury",
      company: "Ebury",
      company_line: "Ebury",
      title: "Senior Product Manager, Onboarding, Identity & Screening",
      date_range: "Apr 2022 – Sep 2023",
      role_summary:
        "Owned onboarding, identity and screening product improvements at a high-growth FX platform, working across Fenergo, Jumio, POSTIDENT, Intelli-corp, LexisNexis and Salesforce",
      bullets: [
        "Mapped the end-to-end onboarding funnel across Spain, Greece and Germany to identify drop-off points and prioritise friction-removal changes across ID&V, screening and CRM hand-offs",
        "Analysed LexisNexis screening outputs and recalibrated threshold configuration via the LexisNexis API, reducing avoidable manual matches while maintaining regulatory standards",
        "Owned ID&V journey design across Jumio, POSTIDENT and Intelli-corp, defining vendor logic, local-market requirements and Salesforce integration requirements to improve onboarding reliability and speed",
        "Designed a continuous monitoring model for medium and low-risk segments, changing post-onboarding review triggers and reducing unnecessary client touchpoints",
        "Led Salesforce-Fenergo integration delivery and 50k+ record migration, defining data mapping, cutover rules, data quality checks and vendor coordination with no downtime",
      ],
      tailorable: true,
    },
    {
      id: "mema",
      company: "MEMA Consultants",
      company_line: "MEMA Consultants",
      title: "Founder & Director",
      date_range: "Mar 2017 – Present",
      role_summary: "Founded regulatory compliance consultancy and shipped RegTech products for financial services firms",
      bullets: [
        "Designed and shipped FCA Fines Dashboard, Vulnerability Portal and SMCR Platform, turning repeat regulatory problems into live subscription products",
        "Owned discovery, feature scope, UX, scraping logic, API integrations and data pipelines across tools built with Next.js/React and AI-assisted workflows",
        "Built, launched and iterated the products without a dedicated engineering team",
        "Grew the consultancy to 25+ clients by packaging recurring compliance needs into reusable products rather than bespoke advisory work",
      ],
      tailorable: true,
    },
    {
      id: "elucidate",
      company: "Elucidate",
      company_line: "Elucidate",
      title: "Product Manager",
      date_range: "Sep 2020 – Mar 2022",
      role_summary: "Led product strategy, client discovery and delivery for a correspondent banking risk assessment SaaS platform",
      bullets: [
        "Led zero-to-one discovery and solution design for a global bank PoC, defining proposition, requirements, success measures and rollout plan for enterprise deployment",
        "Acted as product lead for enterprise API onboarding, mapping client data requirements and implementation steps through the Elucidate platform API; defined Salesforce API requirements for internal CRM workflows",
        "Led pre-sales solution conversations as the financial crime SME, translating AML risk models and platform capability into buyer-ready propositions and shaping requirements before delivery",
        "Led usability studies and front-end prioritisation, increasing monthly active users by 40% and reducing deployment time from 10 to 6 weeks",
      ],
      tailorable: true,
    },
    {
      id: "n26",
      company: "N26",
      company_line: "N26",
      title: "Financial Crime Change, Product & Compliance",
      date_range: "Sep 2019 – Sep 2020",
      role_summary:
        "Financial crime product, compliance and remediation change at a fast-scaling digital bank under BaFin regulatory scrutiny",
      bullets: [
        "Defined requirements across transaction monitoring, sanctions screening and EDD remediation during BaFin remediation; work contributed to closure of 12 audit points",
        "Embedded customer risk-rating rules into product logic as part of the controls framework and Business-Wide Risk Assessment; rationalised sanctions list subscriptions to halve alert volume",
        "Helped stand up the EDD review team and clear a 470-case PEP backlog, reducing review time by 50%",
      ],
      tailorable: true,
    },
  ],
  previous_experience: [
    "Senior Associate, Financial Crime Advisory | Ernst & Young | Feb 2017 – Aug 2019",
    "Assistant Manager, Financial Services Consulting | Mazars | Aug 2015 – Feb 2017",
    "Associate, Authorisations | Financial Conduct Authority | Feb 2014 – Aug 2015",
    "Investment Adjudicator | Financial Ombudsman Service | Apr 2012 – Feb 2014",
  ],
  competencies: [
    {
      id: "product_engineering_competencies",
      label: "Product & Engineering",
      items: [
        "backlog ownership",
        "user stories",
        "sprint delivery",
        "discovery and requirements",
        "workflow and journey design",
        "feature prioritisation",
        "UAT",
        "go-live",
        "hypercare",
        "stakeholder management",
        "vendor evaluation",
      ],
    },
    {
      id: "platforms_apis_competencies",
      label: "Platforms & APIs",
      items: [
        "Fenergo CLM",
        "Napier Screening",
        "Enate Orchestration",
        "Elucidate platform API",
        "LexisNexis API",
        "Jumio",
        "POSTIDENT and Intelli-corp APIs",
        "Salesforce integrations",
        "Power BI",
        "Microsoft Fabric",
        "data mapping and migration",
      ],
    },
    {
      id: "financial_crime_competencies",
      label: "Financial Crime",
      items: [
        "onboarding",
        "KYC",
        "KYB",
        "CDD and EDD",
        "AML and sanctions screening",
        "transaction monitoring",
        "digital banking",
        "B2B fintech",
        "UK MLR",
        "POCA",
        "JMLSG",
      ],
    },
  ],
  education: ["LLB Law | University of Hull | 2007 – 2010"],
  certifications: ["ACAMS Certified", "ICA Fellow", "Agile Product Management Certified"],
  governance: ["School Governor | Conway Primary School (2015–2019)"],
});

const CV_SECTION_DEFS = Object.freeze([
  { key: "summary", label: "Professional Summary", isArray: false },
  { key: "key_achievements", label: "Key Achievements", isArray: true },
  { key: "vistra_bullets", label: "Vistra Experience", isArray: true, experienceId: "vistra" },
  { key: "ebury_bullets", label: "Ebury Experience", isArray: true, experienceId: "ebury" },
  { key: "mema_bullets", label: "MEMA Experience", isArray: true, experienceId: "mema" },
  { key: "elucidate_bullets", label: "Elucidate Experience", isArray: true, experienceId: "elucidate" },
  { key: "n26_bullets", label: "N26 Experience", isArray: true, experienceId: "n26" },
  {
    key: "product_engineering_competencies",
    label: "Product & Engineering Competencies",
    isArray: true,
    competencyId: "product_engineering_competencies",
  },
  {
    key: "platforms_apis_competencies",
    label: "Platforms & APIs Competencies",
    isArray: true,
    competencyId: "platforms_apis_competencies",
  },
  {
    key: "financial_crime_competencies",
    label: "Financial Crime Competencies",
    isArray: true,
    competencyId: "financial_crime_competencies",
  },
]);

const EXPERIENCE_KEY_BY_ID = Object.freeze(
  CV_SECTION_DEFS.filter((section) => section.experienceId).reduce((acc, section) => {
    acc[section.experienceId] = section.key;
    return acc;
  }, {})
);

const COMPETENCY_KEY_BY_ID = Object.freeze(
  CV_SECTION_DEFS.filter((section) => section.competencyId).reduce((acc, section) => {
    acc[section.competencyId] = section.key;
    return acc;
  }, {})
);

const hasArrayValue = (value) => Array.isArray(value) && value.some((item) => String(item || "").trim());
const hasStringValue = (value) => typeof value === "string" && value.trim();

const getDefaultBaseCvSections = () => {
  const sections = {
    summary: MASTER_CV_SCHEMA.summary,
    key_achievements: [...MASTER_CV_SCHEMA.key_achievements],
    experience_overrides: {},
    competency_overrides: {},
    master_cv_version: MASTER_CV_SCHEMA.version,
  };

  MASTER_CV_SCHEMA.experience.forEach((item) => {
    const key = EXPERIENCE_KEY_BY_ID[item.id];
    if (key) sections[key] = [...item.bullets];
  });

  MASTER_CV_SCHEMA.competencies.forEach((item) => {
    const key = COMPETENCY_KEY_BY_ID[item.id];
    if (key) sections[key] = [...item.items];
  });

  return sections;
};

const normalizeTailoredCvSections = (sections = {}) => {
  const defaults = getDefaultBaseCvSections();
  const normalized = { ...sections };
  const experienceOverrides = { ...(sections.experience_overrides || {}) };
  const competencyOverrides = { ...(sections.competency_overrides || {}) };

  CV_SECTION_DEFS.forEach((section) => {
    const directValue = normalized[section.key];
    if (section.experienceId && hasArrayValue(directValue)) {
      experienceOverrides[section.experienceId] = [...directValue];
    }
    if (section.competencyId && hasArrayValue(directValue)) {
      competencyOverrides[section.competencyId] = [...directValue];
    }
  });

  Object.entries(experienceOverrides).forEach(([experienceId, bullets]) => {
    const key = EXPERIENCE_KEY_BY_ID[experienceId];
    if (key && hasArrayValue(bullets)) normalized[key] = [...bullets];
  });

  Object.entries(competencyOverrides).forEach(([competencyId, items]) => {
    const key = COMPETENCY_KEY_BY_ID[competencyId];
    if (key && hasArrayValue(items)) normalized[key] = [...items];
  });

  CV_SECTION_DEFS.forEach((section) => {
    if (normalized[section.key] === undefined && defaults[section.key] !== undefined) {
      normalized[section.key] = section.isArray ? [...defaults[section.key]] : defaults[section.key];
    }
  });

  normalized.experience_overrides = experienceOverrides;
  normalized.competency_overrides = competencyOverrides;
  normalized.master_cv_version = sections.master_cv_version || MASTER_CV_SCHEMA.version;

  return normalized;
};

const pickSectionValue = (key, baseSections, tailoredSections, isArray) => {
  const tailoredValue = tailoredSections[key];
  if (isArray) {
    if (hasArrayValue(tailoredValue)) return [...tailoredValue];
    return [...(baseSections[key] || [])];
  }
  if (hasStringValue(tailoredValue)) return tailoredValue.trim();
  return String(baseSections[key] || "");
};

const getResolvedCvSections = ({ baseSections = {}, tailoredSections = {} } = {}) => {
  const resolvedBase = { ...getDefaultBaseCvSections(), ...baseSections };
  const normalizedTailored = normalizeTailoredCvSections(tailoredSections);
  const resolved = {
    experience_overrides: {},
    competency_overrides: {},
    master_cv_version: MASTER_CV_SCHEMA.version,
  };

  CV_SECTION_DEFS.forEach((section) => {
    resolved[section.key] = pickSectionValue(section.key, resolvedBase, normalizedTailored, section.isArray);
    if (section.experienceId) resolved.experience_overrides[section.experienceId] = [...resolved[section.key]];
    if (section.competencyId) resolved.competency_overrides[section.competencyId] = [...resolved[section.key]];
  });

  return resolved;
};

const collectNumbers = (items = []) =>
  items
    .join(" ")
    .match(/(?:£\\s*)?\\d[\\d+,\\.]*%?|\\b\\d+\\+\\b/g)
    ?.map((item) => item.replace(/\\s+/g, "")) || [];

const validateCvVariant = ({ baseSections = {}, tailoredSections = {} } = {}) => {
  const resolvedSections = getResolvedCvSections({ baseSections, tailoredSections });
  const warnings = [];
  const errors = [];

  const repeatedNumbers = collectNumbers([
    ...resolvedSections.key_achievements,
    ...resolvedSections.vistra_bullets,
    ...resolvedSections.ebury_bullets,
    ...resolvedSections.mema_bullets,
    ...resolvedSections.elucidate_bullets,
    ...resolvedSections.n26_bullets,
  ]).filter((value, index, list) => list.indexOf(value) !== index);

  if (repeatedNumbers.length) {
    warnings.push(`Repeated metrics detected: ${Array.from(new Set(repeatedNumbers)).join(", ")}`);
  }

  if (!hasStringValue(resolvedSections.summary)) {
    errors.push("Summary is empty");
  }

  if ((resolvedSections.key_achievements || []).length < 4) {
    warnings.push("Key achievements section is shorter than the master CV");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      repeated_metric_count: Array.from(new Set(repeatedNumbers)).length,
      section_count: CV_SECTION_DEFS.length,
      master_cv_version: MASTER_CV_SCHEMA.version,
    },
  };
};

const buildMasterCvPromptText = () => {
  const lines = [];
  lines.push(`${MASTER_CV_SCHEMA.header.full_name}`);
  lines.push(
    `${MASTER_CV_SCHEMA.header.location} | ${MASTER_CV_SCHEMA.header.phone} | ${MASTER_CV_SCHEMA.header.email} | ${MASTER_CV_SCHEMA.header.linkedin_url}`
  );
  lines.push(`Portfolio: ${MASTER_CV_SCHEMA.header.portfolio_items.join(" | ")}`);
  lines.push("");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(MASTER_CV_SCHEMA.summary);
  lines.push("");
  lines.push("KEY ACHIEVEMENTS");
  MASTER_CV_SCHEMA.key_achievements.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("PROFESSIONAL EXPERIENCE");
  MASTER_CV_SCHEMA.experience.forEach((entry) => {
    lines.push(`${entry.title} | ${entry.company_line}`);
    lines.push(entry.date_range);
    lines.push(entry.role_summary);
    entry.bullets.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  });
  lines.push("PREVIOUS EXPERIENCE");
  MASTER_CV_SCHEMA.previous_experience.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("CORE COMPETENCIES");
  MASTER_CV_SCHEMA.competencies.forEach((item) => lines.push(`${item.label}: ${item.items.join(", ")}`));
  lines.push("");
  lines.push("EDUCATION & CERTIFICATIONS");
  MASTER_CV_SCHEMA.education.forEach((item) => lines.push(`- ${item}`));
  MASTER_CV_SCHEMA.certifications.forEach((item) => lines.push(`- ${item}`));
  MASTER_CV_SCHEMA.governance.forEach((item) => lines.push(`- ${item}`));
  return lines.join("\n");
};

module.exports = {
  MASTER_CV_VERSION,
  MASTER_CV_SCHEMA,
  CV_SECTION_DEFS,
  getDefaultBaseCvSections,
  normalizeTailoredCvSections,
  getResolvedCvSections,
  validateCvVariant,
  buildMasterCvPromptText,
};
