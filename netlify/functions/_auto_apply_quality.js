const ATS_STOPWORDS = new Set([
  "ability",
  "and",
  "appropriate",
  "demonstrated",
  "experience",
  "excellent",
  "for",
  "good",
  "including",
  "knowledge",
  "must",
  "of",
  "or",
  "product",
  "relevant",
  "required",
  "role",
  "skills",
  "strong",
  "the",
  "to",
  "understanding",
  "with",
  "within",
]);

const normalizeToken = (value) => {
  let token = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (token.length > 5 && token.endsWith("ies")) token = `${token.slice(0, -3)}y`;
  else if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) token = token.slice(0, -1);
  return token;
};

const tokenize = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !ATS_STOPWORDS.has(token));

const flattenStrings = (value, output = []) => {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => flattenStrings(item, output));
  return output;
};

const buildAtsKeywordCoverage = (job, tailoredSections) => {
  const requirements = Array.isArray(job?.key_requirements)
    ? job.key_requirements.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!requirements.length) return null;

  const cvTokens = new Set(tokenize(flattenStrings(tailoredSections).join(" ")));
  const found = [];
  const missing = [];
  const details = [];

  requirements.forEach((requirement) => {
    const tokens = [...new Set(tokenize(requirement))];
    const matchedTokens = tokens.filter((token) => cvTokens.has(token));
    const requiredMatches = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length / 2);
    const matched = tokens.length > 0 && matchedTokens.length >= Math.max(1, requiredMatches);
    (matched ? found : missing).push(requirement);
    details.push({ requirement, matched, matched_tokens: matchedTokens, total_tokens: tokens.length });
  });

  return {
    score: Math.round((found.length / requirements.length) * 100),
    found: found.length,
    total: requirements.length,
    missing,
    details,
  };
};

const assessApplicationPackQuality = ({
  job,
  pack,
  minAtsCoverage = 80,
  minCvQualityScore = 90,
  minApplicationQualityScore = 90,
  requireAtsCoverage = true,
} = {}) => {
  const tailoredSections = pack?.tailoredCvSections || {};
  const cvValidation = pack?.cvValidation || job?.cv_validation || {};
  const cvQualityStatus = tailoredSections.quality_status || cvValidation.quality_status || "unknown";
  const cvQualityScore = Number(cvValidation.quality_score || cvValidation.metrics?.quality_score || 0);
  const atsCoverage = buildAtsKeywordCoverage(job, tailoredSections);
  const applicationValidation = pack?.applicationValidation || job?.application_validation || {};
  const applicationQualityScore = Number(applicationValidation.quality_score || 0);
  const reasons = [];

  if (cvValidation.ok !== true || cvValidation.decision !== "accept") {
    reasons.push("CV validation did not pass");
  }
  if (cvQualityStatus !== "accepted") {
    reasons.push(`CV quality status is ${cvQualityStatus}`);
  }
  if (cvQualityScore < Number(minCvQualityScore)) {
    reasons.push(`CV quality ${cvQualityScore} is below ${Number(minCvQualityScore)}`);
  }
  if (applicationValidation.ok !== true) {
    reasons.push("Application answers did not pass validation");
    (Array.isArray(applicationValidation.errors) ? applicationValidation.errors : [])
      .slice(0, 3)
      .forEach((error) => reasons.push(`Application: ${error}`));
  }
  if (applicationQualityScore < Number(minApplicationQualityScore)) {
    reasons.push(`Application quality ${applicationQualityScore} is below ${Number(minApplicationQualityScore)}`);
  }
  if (!atsCoverage) {
    if (requireAtsCoverage) reasons.push("ATS coverage could not be measured because requirements are missing");
  } else if (atsCoverage.score < Number(minAtsCoverage)) {
    reasons.push(`ATS coverage ${atsCoverage.score}% is below ${Number(minAtsCoverage)}%`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    atsCoverage,
    cvQualityScore,
    cvQualityStatus,
    applicationQualityScore,
  };
};

module.exports = {
  assessApplicationPackQuality,
  buildAtsKeywordCoverage,
};
