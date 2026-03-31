const { getCvReferenceProfile, CV_REFERENCE_PROFILES } = require('./_cv_reference_profiles');
const { inferRoleFamily, buildEvidencePromptContext } = require('./_cv_evidence_library');

const STYLE_PROFILES = Object.freeze(
  Object.fromEntries(
    Object.values(CV_REFERENCE_PROFILES).map((profile) => [
      profile.id,
      {
        id: profile.id,
        label: profile.label,
        prompt: profile.prompt_guidance,
        source_pdf_path: profile.source_pdf_path,
        priority_tags: profile.priority_tags,
      },
    ])
  )
);

const getCvStyleProfile = (job = {}) => {
  const roleFamily = inferRoleFamily(job);
  return STYLE_PROFILES[roleFamily] || STYLE_PROFILES.master_default;
};

const buildCvStyleProfilePrompt = (job = {}) => {
  const roleFamily = inferRoleFamily(job);
  const profile = getCvReferenceProfile(roleFamily);
  const evidence = buildEvidencePromptContext(job, { roleFamily, limit: 8 });
  return {
    profile,
    roleFamily,
    evidence,
    prompt: [
      `Role-family guidance (${profile.label}): ${profile.prompt_guidance}`,
      evidence.prompt,
    ].join('\n\n'),
  };
};

module.exports = {
  STYLE_PROFILES,
  getCvStyleProfile,
  buildCvStyleProfilePrompt,
};
