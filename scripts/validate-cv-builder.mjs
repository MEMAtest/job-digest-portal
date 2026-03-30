import { writeApplicationPack } from './apply-assistant/common.mjs';
import { getDefaultBaseCvSections, validateCvVariant } from '../app.cv.schema.js';

const base = getDefaultBaseCvSections();
const tailored = {
  summary:
    'Onboarding, identity, KYC and financial crime product leader focused on regulated platform delivery, API integrations and workflow orchestration across digital banking and B2B fintech.',
  key_achievements: [...base.key_achievements],
  vistra_bullets: [...base.vistra_bullets],
  ebury_bullets: [...base.ebury_bullets],
  mema_bullets: [...base.mema_bullets],
  elucidate_bullets: [...base.elucidate_bullets],
  n26_bullets: [...base.n26_bullets],
};

const validation = validateCvVariant({ baseSections: base, tailoredSections: tailored });
const result = await writeApplicationPack({
  jobId: 'cv-master-validation',
  role: 'Senior Product Manager, Financial Crime',
  company: 'Validation Co',
  pack: {
    tailoredCvSections: tailored,
    baseCvSections: base,
    answers: {
      fullName: 'Ade Omosanya',
      email: 'ademolaomosanya@gmail.com',
      phone: '07920 497 486',
      location: 'London, United Kingdom',
      linkedinUrl: 'linkedin.com/in/adeomosanya',
      portfolioUrl: 'FCA Fines Dashboard | Vulnerability Portal | SMCR Platform',
    },
  },
});

console.log(JSON.stringify({ result, validation }, null, 2));
