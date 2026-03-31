const { MASTER_CV_SCHEMA } = require('./_cv_schema');
const { getCvReferenceProfile } = require('./_cv_reference_profiles');

const TAG_RULES = Object.freeze([
  { tag: 'onboarding', pattern: /\bonboarding\b/i },
  { tag: 'identity', pattern: /\bidentity\b|id&v|idv/i },
  { tag: 'kyc', pattern: /\bkyc\b/i },
  { tag: 'kyb', pattern: /\bkyb\b/i },
  { tag: 'clm', pattern: /\bclm\b|client lifecycle/i },
  { tag: 'screening', pattern: /\bscreening\b/i },
  { tag: 'financial_crime', pattern: /financial crime|aml|cft/i },
  { tag: 'fraud', pattern: /\bfraud\b/i },
  { tag: 'sanctions', pattern: /\bsanctions?\b/i },
  { tag: 'transaction_monitoring', pattern: /transaction monitoring|\btm\b/i },
  { tag: 'controls', pattern: /controls?|risk-rating|risk scoring/i },
  { tag: 'edd', pattern: /\bedd\b/i },
  { tag: 'cdd', pattern: /\bcdd\b/i },
  { tag: 'api_integrations', pattern: /\bapi\b|integrations?/i },
  { tag: 'data_mapping', pattern: /data mapping|payload|endpoint|migration/i },
  { tag: 'migration', pattern: /migration|record(s)?/i },
  { tag: 'product_delivery', pattern: /backlog|user stories|sprint|delivery|requirements|prioritis/i },
  { tag: 'engineering', pattern: /engineering|engineers?|tech leads?/i },
  { tag: 'vendor_management', pattern: /vendor|delivery team|relationship/i },
  { tag: 'uat', pattern: /\buat\b|qa validation|hypercare/i },
  { tag: 'go_live', pattern: /go-live|go live|cutover/i },
  { tag: 'programme', pattern: /programme|program|roadmap|governance/i },
  { tag: 'architecture', pattern: /architecture|target-state|orchestration|workflow/i },
  { tag: 'mi_dashboards', pattern: /dashboard|reporting|power bi|microsoft fabric|mi\b/i },
  { tag: 'regulatory_remediation', pattern: /regulatory|bafin|dnb|audit points|remediation/i },
  { tag: 'fenergo', pattern: /\bfenergo\b/i },
  { tag: 'napier', pattern: /\bnapier\b/i },
  { tag: 'enate', pattern: /\benate\b/i },
  { tag: 'salesforce', pattern: /\bsalesforce\b/i },
  { tag: 'lexisnexis', pattern: /lexisnexis/i },
  { tag: 'jumio', pattern: /jumio/i },
  { tag: 'postident', pattern: /postident/i },
  { tag: 'intelli_corp', pattern: /intelli-corp/i },
  { tag: 'pre_sales', pattern: /pre-sales|pre sales|poc|proof of concept|correspondent banking/i },
  { tag: 'regtech_product_build', pattern: /regtech products?|subscription products?|scraping|ai-assisted workflows?/i },
  { tag: 'corporate_clients', pattern: /corporate|institutional|beneficial ownership|entity structures/i },
]);

const ROLE_FAMILY_PATTERNS = Object.freeze([
  { id: 'financial_crime_ops', pattern: /fraud|financial crime|aml|sanctions|transaction monitoring|controls|remediation|screening/i },
  { id: 'fenergo_delivery', pattern: /fenergo/i },
  { id: 'institutional_clm', pattern: /client lifecycle|clm|corporate|institutional|capital markets|wholesale/i },
  { id: 'clm_programme', pattern: /clm|onboarding|kyc|cdd|edd|kyb|napier|enate/i },
  { id: 'product_delivery', pattern: /backlog|user stories|sprint|delivery|implementation|api|integration|migration|workflow|product owner|programme|program/i },
]);

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const extractTags = (text = '') => {
  const normalized = normalizeText(text);
  return TAG_RULES.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.tag);
};

const scoreTagOverlap = (jobTags = [], evidenceTags = []) => {
  const jobSet = new Set(jobTags);
  return evidenceTags.reduce((sum, tag) => sum + (jobSet.has(tag) ? 1 : 0), 0);
};

const inferRoleFamily = (job = {}) => {
  const haystack = normalizeText(`${job.role || ''} ${job.company || ''} ${job.notes || ''} ${job.description || ''} ${job.role_summary || ''}`).toLowerCase();
  const match = ROLE_FAMILY_PATTERNS.find((entry) => entry.pattern.test(haystack));
  return match ? match.id : 'master_default';
};

const buildMasterEvidence = () => {
  const items = [];
  items.push({
    id: 'master_summary',
    kind: 'summary',
    source: 'master',
    profile_id: 'master_default',
    text: MASTER_CV_SCHEMA.summary,
    tags: extractTags(MASTER_CV_SCHEMA.summary),
  });

  MASTER_CV_SCHEMA.key_achievements.forEach((text, index) => {
    items.push({
      id: `achievement_${index + 1}`,
      kind: 'achievement',
      source: 'master',
      profile_id: 'master_default',
      text,
      tags: extractTags(text),
    });
  });

  MASTER_CV_SCHEMA.experience.forEach((entry) => {
    items.push({
      id: `${entry.id}_role_summary`,
      kind: 'role_summary',
      source: 'master',
      profile_id: 'master_default',
      experience_id: entry.id,
      company: entry.company,
      text: entry.role_summary,
      tags: extractTags(`${entry.title} ${entry.role_summary}`),
    });
    entry.bullets.forEach((text, index) => {
      items.push({
        id: `${entry.id}_bullet_${index + 1}`,
        kind: 'experience_bullet',
        source: 'master',
        profile_id: 'master_default',
        experience_id: entry.id,
        company: entry.company,
        text,
        tags: extractTags(`${entry.title} ${text}`),
      });
    });
  });

  return items;
};

const buildReferenceEvidence = () => {
  const profileIds = ['financial_crime_ops', 'product_delivery', 'clm_programme', 'fenergo_delivery', 'institutional_clm'];
  const items = [];

  profileIds.forEach((profileId) => {
    const profile = getCvReferenceProfile(profileId);
    items.push({
      id: `${profileId}_summary_reference`,
      kind: 'reference_summary',
      source: 'reference',
      profile_id: profileId,
      text: profile.summary_reference,
      tags: Array.from(new Set([...(profile.priority_tags || []), ...extractTags(profile.summary_reference)])),
    });
    (profile.achievement_references || []).forEach((text, index) => {
      items.push({
        id: `${profileId}_achievement_reference_${index + 1}`,
        kind: 'reference_achievement',
        source: 'reference',
        profile_id: profileId,
        text,
        tags: Array.from(new Set([...(profile.priority_tags || []), ...extractTags(text)])),
      });
    });
  });

  return items;
};

const EVIDENCE_LIBRARY = Object.freeze([...buildMasterEvidence(), ...buildReferenceEvidence()]);

const buildJobTagSet = (job = {}, roleFamily = inferRoleFamily(job)) => {
  const jobText = normalizeText(`${job.role || ''} ${job.company || ''} ${job.notes || ''} ${job.description || ''} ${job.role_summary || ''}`);
  const referenceProfile = getCvReferenceProfile(roleFamily);
  return Array.from(new Set([roleFamily, ...extractTags(jobText), ...(referenceProfile.priority_tags || [])]));
};

const rankEvidenceForJob = (job = {}, options = {}) => {
  const roleFamily = options.roleFamily || inferRoleFamily(job);
  const jobTags = buildJobTagSet(job, roleFamily);
  const referenceProfile = getCvReferenceProfile(roleFamily);
  const limit = Number(options.limit || 8);

  return [...EVIDENCE_LIBRARY]
    .map((item) => {
      const overlapScore = scoreTagOverlap(jobTags, item.tags || []);
      const profileBoost = item.profile_id === roleFamily ? 3 : item.profile_id === 'master_default' ? 1 : 0;
      const referenceBoost = item.source === 'reference' ? 1 : 0;
      const score = overlapScore * 4 + profileBoost + referenceBoost;
      return { ...item, score, role_family: roleFamily, reference_profile_label: referenceProfile.label };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const buildEvidencePromptContext = (job = {}, options = {}) => {
  const roleFamily = options.roleFamily || inferRoleFamily(job);
  const referenceProfile = getCvReferenceProfile(roleFamily);
  const rankedEvidence = rankEvidenceForJob(job, { roleFamily, limit: options.limit || 8 });

  const lines = [];
  lines.push(`Selected role family: ${referenceProfile.label}`);
  lines.push(`Reference summary style: ${referenceProfile.summary_reference}`);
  lines.push('Reference achievement cues:');
  referenceProfile.achievement_references.forEach((item) => lines.push(`- ${item}`));
  lines.push('Highest-priority evidence from the master/reference library:');
  rankedEvidence.forEach((item) => {
    lines.push(`- [${item.source}/${item.kind}] ${item.text}`);
  });

  return {
    roleFamily,
    referenceProfile,
    rankedEvidence,
    prompt: lines.join('\n'),
  };
};

const scoreEvidenceAlignment = (sections = {}, job = {}, options = {}) => {
  const roleFamily = options.roleFamily || inferRoleFamily(job);
  const jobTags = buildJobTagSet(job, roleFamily);
  const text = normalizeText([
    sections.summary || '',
    ...(sections.key_achievements || []),
    ...(sections.vistra_bullets || []),
    ...(sections.ebury_bullets || []),
    ...(sections.mema_bullets || []),
    ...(sections.elucidate_bullets || []),
    ...(sections.n26_bullets || []),
  ].join(' '));
  const sectionTags = extractTags(text);
  return scoreTagOverlap(jobTags, sectionTags);
};

module.exports = {
  TAG_RULES,
  EVIDENCE_LIBRARY,
  inferRoleFamily,
  extractTags,
  buildJobTagSet,
  rankEvidenceForJob,
  buildEvidencePromptContext,
  scoreEvidenceAlignment,
};
