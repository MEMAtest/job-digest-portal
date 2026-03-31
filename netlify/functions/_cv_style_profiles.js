const STYLE_PROFILES = Object.freeze({
  master_default: {
    id: "master_default",
    label: "Master Default",
    prompt:
      "Stay closest to the master CV. Keep the tone compact, factual and grounded in regulated product delivery, onboarding, KYC, screening and financial crime. Preserve concrete tools, platforms, jurisdictions and operating-scope evidence from the master CV.",
  },
  financial_crime_ops: {
    id: "financial_crime_ops",
    label: "Financial Crime & Fraud Operations",
    prompt:
      "Prioritise financial crime, fraud, controls, screening, sanctions, transaction monitoring, remediation and first-line operating-model evidence that already exists in the master CV. Do not invent direct fraud-ops leadership if the master only supports product, controls or remediation language.",
  },
  clm_onboarding: {
    id: "clm_onboarding",
    label: "CLM & Onboarding",
    prompt:
      "Prioritise client lifecycle, onboarding, KYC, CDD, EDD, screening, workflow design, jurisdictional rollout, remediation and operating-model language already present in the master CV. Keep Fenergo, Napier, Enate and API integration evidence where relevant.",
  },
  fenergo_delivery: {
    id: "fenergo_delivery",
    label: "Fenergo Delivery",
    prompt:
      "Prioritise Fenergo CLM journey design, entity and service capture, risk assessment, document collection, integration requirements, data mapping, migration, UAT, go-live and hypercare language already present in the master CV.",
  },
  product_delivery: {
    id: "product_delivery",
    label: "Product Delivery",
    prompt:
      "Prioritise backlog ownership, user stories, sprint delivery, requirements, vendor coordination, API integration, data mapping, migration, go-live and hypercare language already present in the master CV. Keep the wording execution-focused rather than generic leadership prose.",
  },
});

const getCvStyleProfile = (job = {}) => {
  const haystack = `${job.role || ""} ${job.company || ""} ${job.notes || ""} ${job.description || ""} ${job.role_summary || ""}`.toLowerCase();

  if (/(fraud|financial crime|aml|sanctions|transaction monitoring|tm\b|remediation|screening|controls)/i.test(haystack)) {
    return STYLE_PROFILES.financial_crime_ops;
  }
  if (/(fenergo|client lifecycle|clm|onboarding|kyc|cdd|edd|kyb)/i.test(haystack)) {
    if (/fenergo/i.test(haystack)) {
      return STYLE_PROFILES.fenergo_delivery;
    }
    return STYLE_PROFILES.clm_onboarding;
  }
  if (/(product owner|programme|program|delivery|implementation|api|integration|migration|workflow|operations)/i.test(haystack)) {
    return STYLE_PROFILES.product_delivery;
  }
  return STYLE_PROFILES.master_default;
};

const buildCvStyleProfilePrompt = (job = {}) => {
  const profile = getCvStyleProfile(job);
  return {
    profile,
    prompt: `Role-family guidance (${profile.label}): ${profile.prompt}`,
  };
};

module.exports = {
  STYLE_PROFILES,
  getCvStyleProfile,
  buildCvStyleProfilePrompt,
};
