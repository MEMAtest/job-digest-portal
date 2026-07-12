const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeForComparison = (value) =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9£%+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sentence = (value) => {
  const text = cleanText(value).replace(/[.;:,]+$/, "");
  return text ? `${text}.` : "";
};

const getEvidenceStatements = (tailoredSections) => {
  const achievements = Array.isArray(tailoredSections?.key_achievements)
    ? tailoredSections.key_achievements.map(cleanText).filter(Boolean)
    : [];
  return achievements.slice(0, 3);
};

const getRoleFocus = (job) => {
  const requirements = Array.isArray(job?.key_requirements)
    ? job.key_requirements.map(cleanText).filter(Boolean).slice(0, 3)
    : [];
  return requirements.length
    ? requirements.join("; ")
    : "product ownership, regulated platform delivery and cross-functional execution";
};

const buildApplicationAnswers = ({ job = {}, profile = {}, tailoredSections = {} } = {}) => {
  const role = cleanText(job.role) || "the advertised role";
  const company = cleanText(job.company) || "the organisation";
  const focus = getRoleFocus(job);
  const evidence = getEvidenceStatements(tailoredSections);
  const summary = cleanText(tailoredSections.summary || tailoredSections.professional_summary);
  const evidenceOne = evidence[0] || summary;
  const evidenceTwo = evidence[1] || summary;

  const whyThisRole = [
    `I am interested in the ${role} role because its focus on ${focus} closely matches my experience.`,
    `Two directly relevant examples are: ${sentence(evidenceOne)} ${sentence(evidenceTwo)}`,
  ]
    .filter(Boolean)
    .join(" ");

  const whyThisCompany = [
    `I am interested in ${company} because the ${role} position offers the opportunity to work on ${focus}.`,
    `One directly relevant achievement is: ${sentence(evidenceOne)}`,
  ]
    .filter(Boolean)
    .join(" ");

  const coverLines = [
    "Dear Hiring Team,",
    "",
    `I am applying for the ${role} position at ${company}.`,
    summary,
    "",
    `The role's priorities around ${focus} align closely with my experience. Relevant achievements include:`,
    ...evidence.map((item) => `- ${item}`),
    "",
    `I would welcome the opportunity to discuss how this experience could support the ${role} position at ${company}.`,
    "",
    "Kind regards,",
    cleanText(profile.fullName),
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "");

  return {
    fullName: cleanText(profile.fullName),
    email: cleanText(profile.email),
    phone: cleanText(profile.phone),
    location: cleanText(profile.location),
    linkedinUrl: cleanText(profile.linkedinUrl),
    portfolioUrl: cleanText(profile.portfolioUrl),
    rightToWorkUk: cleanText(profile.rightToWorkUk) || "Yes",
    noticePeriod: cleanText(profile.noticePeriod),
    salaryExpectation: cleanText(profile.salaryExpectation),
    whyThisRole,
    whyThisCompany,
    coverLetter: coverLines.join("\n").trim(),
  };
};

const PROHIBITED_NARRATIVE_PATTERNS = [
  { pattern: /\bade(?:'s| is| has| brings)\b/i, label: "third-person candidate wording" },
  { pattern: /\b(?:the )?candidate(?:'s)?\b/i, label: "candidate coaching wording" },
  { pattern: /\bstrongest angle\b/i, label: "internal positioning guidance" },
  { pattern: /\bmatch should be positioned\b/i, label: "internal positioning guidance" },
  { pattern: /\blead the application\b/i, label: "internal application guidance" },
  { pattern: /\bde-?emphasi[sz]e\b/i, label: "internal application guidance" },
  { pattern: /\blikely role focus\b/i, label: "internal role-analysis wording" },
  { pattern: /\bwill be generated\b/i, label: "generation placeholder" },
  { pattern: /\b(?:todo|tbd|lorem ipsum)\b/i, label: "placeholder text" },
  { pattern: /\[(?:company|role|name|insert|tbd)[^\]]*\]/i, label: "template placeholder" },
];

const NARRATIVE_RULES = [
  { key: "whyThisRole", label: "Why this role", minWords: 35, maxWords: 260 },
  { key: "whyThisCompany", label: "Why this company", minWords: 30, maxWords: 220 },
  { key: "coverLetter", label: "Cover letter", minWords: 120, maxWords: 550 },
];

const countWords = (value) => cleanText(value).split(/\s+/).filter(Boolean).length;
const countExactEvidence = (text, evidence) => {
  const normalized = normalizeForComparison(text);
  return evidence.filter((item) => normalized.includes(normalizeForComparison(item))).length;
};

const validateApplicationAnswers = ({ job = {}, profile = {}, answers = {}, tailoredSections = {} } = {}) => {
  const errors = [];
  const warnings = [];
  const role = cleanText(job.role);
  const company = cleanText(job.company);
  const evidence = getEvidenceStatements(tailoredSections);

  ["fullName", "email", "phone", "location", "rightToWorkUk"].forEach((field) => {
    if (!cleanText(answers[field])) errors.push(`Required application field is missing: ${field}`);
  });
  if (answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(answers.email))) {
    errors.push("Application email address is invalid");
  }
  if (answers.phone && cleanText(answers.phone).replace(/\D/g, "").length < 10) {
    errors.push("Application phone number is invalid");
  }

  [
    "fullName",
    "email",
    "phone",
    "location",
    "linkedinUrl",
    "portfolioUrl",
    "rightToWorkUk",
    "noticePeriod",
    "salaryExpectation",
  ].forEach((field) => {
    const expected = normalizeForComparison(profile[field]);
    const actual = normalizeForComparison(answers[field]);
    if (expected && actual !== expected) errors.push(`Application field does not match the approved profile: ${field}`);
  });

  NARRATIVE_RULES.forEach(({ key, label, minWords, maxWords }) => {
    const text = cleanText(answers[key]);
    const words = countWords(text);
    if (!text) {
      errors.push(`${label} is missing`);
      return;
    }
    if (words < minWords) errors.push(`${label} is too short (${words} words; minimum ${minWords})`);
    if (words > maxWords) errors.push(`${label} is too long (${words} words; maximum ${maxWords})`);
    if (!/\b(?:I|my|me)\b/i.test(text)) errors.push(`${label} is not written in the first person`);
    if (/[<>]|[\u2022\u25aa\u2192\u2014]/.test(text)) errors.push(`${label} contains non-ATS-safe formatting`);
    PROHIBITED_NARRATIVE_PATTERNS.forEach(({ pattern, label: reason }) => {
      if (pattern.test(text)) errors.push(`${label} contains ${reason}`);
    });
  });

  const normalizedRole = normalizeForComparison(role);
  const normalizedCompany = normalizeForComparison(company);
  const cover = normalizeForComparison(answers.coverLetter);
  const whyRole = normalizeForComparison(answers.whyThisRole);
  const whyCompany = normalizeForComparison(answers.whyThisCompany);
  if (normalizedRole && !cover.includes(normalizedRole)) errors.push("Cover letter does not name the target role");
  if (normalizedCompany && !cover.includes(normalizedCompany)) errors.push("Cover letter does not name the target company");
  if (normalizedRole && !whyRole.includes(normalizedRole)) errors.push("Why this role does not name the target role");
  if (normalizedCompany && !whyCompany.includes(normalizedCompany)) errors.push("Why this company does not name the target company");
  if (normalizedRole && !whyCompany.includes(normalizedRole)) warnings.push("Why this company does not name the target role");

  if (evidence.length < 2) {
    errors.push("The accepted CV does not contain enough achievement evidence for an application");
  } else {
    const coverEvidenceCount = countExactEvidence(answers.coverLetter, evidence);
    const roleEvidenceCount = countExactEvidence(answers.whyThisRole, evidence);
    const companyEvidenceCount = countExactEvidence(answers.whyThisCompany, evidence);
    if (coverEvidenceCount < 2) errors.push("Cover letter is not traceable to at least two accepted CV achievements");
    if (roleEvidenceCount < 2) errors.push("Why this role is not traceable to at least two accepted CV achievements");
    if (companyEvidenceCount < 1) errors.push("Why this company is not traceable to an accepted CV achievement");
  }

  const qualityScore = Math.max(0, 100 - errors.length * 20 - warnings.length * 5);
  return {
    ok: errors.length === 0,
    quality_score: qualityScore,
    errors,
    warnings,
    metrics: {
      cover_letter_words: countWords(answers.coverLetter),
      why_role_words: countWords(answers.whyThisRole),
      why_company_words: countWords(answers.whyThisCompany),
      cover_letter_evidence_matches: countExactEvidence(answers.coverLetter, evidence),
      why_role_evidence_matches: countExactEvidence(answers.whyThisRole, evidence),
      why_company_evidence_matches: countExactEvidence(answers.whyThisCompany, evidence),
      evidence_available: evidence.length,
    },
  };
};

module.exports = {
  buildApplicationAnswers,
  validateApplicationAnswers,
};
