import { createRequire } from 'node:module';
import { writeApplicationPack } from './apply-assistant/common.mjs';

const require = createRequire(import.meta.url);
const {
  MASTER_CV_SCHEMA,
  getDefaultBaseCvSections,
  finalizeTailoredCvSections,
  validateCvVariant,
} = require('../netlify/functions/_cv_schema.js');
const { inferRoleFamily, rankEvidenceForJob } = require('../netlify/functions/_cv_evidence_library.js');

const base = getDefaultBaseCvSections();

const fixtures = [
  {
    id: 'master-baseline',
    description: 'The untouched master CV should validate cleanly.',
    tailored: {
      summary: base.summary,
      key_achievements: [...base.key_achievements],
      vistra_bullets: [...base.vistra_bullets],
      ebury_bullets: [...base.ebury_bullets],
      mema_bullets: [...base.mema_bullets],
      elucidate_bullets: [...base.elucidate_bullets],
      n26_bullets: [...base.n26_bullets],
    },
    expectedStatus: 'accepted',
  },
  {
    id: 'generic-summary-fallback',
    description: 'A weak generic summary should be replaced with the master summary.',
    tailored: {
      summary:
        'Within the fintech and financial services domain, I deliver transformative platform and workflow changes. My experience spans cross-functional stakeholder management and business growth. I have led dynamic programmes across fast-paced environments.',
      key_achievements: [...base.key_achievements],
      vistra_bullets: [...base.vistra_bullets],
      ebury_bullets: [...base.ebury_bullets],
      mema_bullets: [...base.mema_bullets],
      elucidate_bullets: [...base.elucidate_bullets],
      n26_bullets: [...base.n26_bullets],
    },
    expectedStatus: 'fallback_master',
    expectSummaryFallback: true,
  },
  {
    id: 'clm-targeted-variant',
    description: 'A CLM/onboarding-targeted variant should be accepted if it preserves master evidence.',
    tailored: {
      summary:
        'Senior Product Manager across B2B SaaS, fintech and digital banking platforms focused on onboarding, identity, KYC, screening, CLM and financial crime. Owns backlogs, requirements and sprint delivery with engineering, with direct API integration experience across Fenergo, Napier, LexisNexis, Jumio, POSTIDENT, Intelli-corp, Salesforce and the Elucidate platform API. Led platform, workflow and data-model changes across Vistra, Ebury, Elucidate and N26 spanning 30+ jurisdictions, enterprise client onboarding, remediation and CLM delivery. Independently shipped three live RegTech products using scraping, data pipelines and AI-assisted workflows.',
      key_achievements: [...base.key_achievements],
      vistra_bullets: [...base.vistra_bullets],
      ebury_bullets: [...base.ebury_bullets],
      mema_bullets: [...base.mema_bullets],
      elucidate_bullets: [...base.elucidate_bullets],
      n26_bullets: [...base.n26_bullets],
    },
    expectedStatus: 'accepted',
    job: {
      role: 'Senior Product Manager, Fenergo CLM',
      company: 'Reference Co',
      description: 'Own the Fenergo CLM roadmap, API integrations, migration and go-live delivery for corporate onboarding.',
    },
    expectedRoleFamily: 'fenergo_delivery',
  },
  {
    id: 'fraud-role-family-selection',
    description: 'Fraud and financial-crime roles should map to the fraud reference family.',
    tailored: {
      summary: base.summary,
      key_achievements: [...base.key_achievements],
      vistra_bullets: [...base.vistra_bullets],
      ebury_bullets: [...base.ebury_bullets],
      mema_bullets: [...base.mema_bullets],
      elucidate_bullets: [...base.elucidate_bullets],
      n26_bullets: [...base.n26_bullets],
    },
    job: {
      role: 'Head of Fraud Operations',
      company: 'Validation Co',
      description: 'Lead fraud controls, transaction monitoring, sanctions and financial crime operations.',
    },
    expectedStatus: 'accepted',
    expectedRoleFamily: 'financial_crime_ops',
  },
];

const results = fixtures.map((fixture) => {
  const finalized = finalizeTailoredCvSections({
    baseSections: base,
    tailoredSections: fixture.tailored,
    providerName: 'fixture',
    styleProfileId: 'master_default',
    job: fixture.job || {
      role: fixture.id,
      company: 'Validation Co',
    },
  });
  const validation = validateCvVariant({
    baseSections: base,
    tailoredSections: finalized.sections,
  });
  const job = fixture.job || {
    role: fixture.id,
    company: 'Validation Co',
  };
  const roleFamily = inferRoleFamily(job);
  const rankedEvidence = rankEvidenceForJob(job, { limit: 3 });
  return {
    id: fixture.id,
    description: fixture.description,
    expectedStatus: fixture.expectedStatus,
    actualStatus: finalized.quality_status,
    qualityScore: validation.quality_score,
    warnings: validation.warnings,
    summaryMatchesMaster: finalized.sections.summary === base.summary,
    roleFamily,
    rankedEvidence,
    finalized,
    passed:
      finalized.quality_status === fixture.expectedStatus &&
      (!fixture.expectSummaryFallback || finalized.sections.summary === base.summary) &&
      (!fixture.expectedRoleFamily || roleFamily === fixture.expectedRoleFamily),
  };
});

const failed = results.filter((result) => !result.passed);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.map((item) => ({
    id: item.id,
    expectedStatus: item.expectedStatus,
    actualStatus: item.actualStatus,
    warnings: item.warnings,
    summaryMatchesMaster: item.summaryMatchesMaster,
    roleFamily: item.roleFamily,
  })) }, null, 2));
  process.exit(1);
}

const packResult = await writeApplicationPack({
  jobId: 'cv-master-validation',
  role: 'Senior Product Manager, Financial Crime',
  company: 'Validation Co',
  pack: {
    tailoredCvSections: results[0].finalized.sections,
    baseCvSections: base,
    answers: {
      fullName: MASTER_CV_SCHEMA.header.full_name,
      email: MASTER_CV_SCHEMA.header.email,
      phone: MASTER_CV_SCHEMA.header.phone,
      location: 'London, United Kingdom',
      linkedinUrl: MASTER_CV_SCHEMA.header.linkedin_url,
      portfolioUrl: MASTER_CV_SCHEMA.header.portfolio_items.join(' | '),
    },
  },
});

console.log(JSON.stringify({ ok: true, results: results.map((result) => ({
  id: result.id,
  expectedStatus: result.expectedStatus,
  actualStatus: result.actualStatus,
  qualityScore: result.qualityScore,
  warningCount: result.warnings.length,
  roleFamily: result.roleFamily,
  topEvidenceIds: result.rankedEvidence.map((item) => item.id),
})), packResult }, null, 2));
