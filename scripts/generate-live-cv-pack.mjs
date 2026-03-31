import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeApplicationPack } from './apply-assistant/common.mjs';
import { MASTER_CV_SCHEMA, getDefaultBaseCvSections, normalizeTailoredCvSections, validateCvVariant } from '../app.cv.schema.js';

const require = createRequire(import.meta.url);
const { getFirestore } = require('./firebase_admin');
const { generateTailoredCvSections } = require('../netlify/functions/_cv_generation.js');

const extractEnvValue = (raw, key) => {
  const pattern = new RegExp(`${key}=(.*?)(?:\\n[A-Z0-9_]+=|\\n*$)`, 's');
  const match = raw.match(pattern);
  return match ? match[1].trim() : '';
};

const loadOptionalEnv = () => {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'scripts', '.env'),
  ];
  let serviceAccountJson = '';
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    const openAiKey = extractEnvValue(raw, 'OPENAI_API_KEY');
    if (openAiKey && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = openAiKey;
    const openRouterKey = extractEnvValue(raw, 'OPENROUTER_API_KEY');
    if (openRouterKey && !process.env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = openRouterKey;
    const openRouterModel = extractEnvValue(raw, 'JOB_DIGEST_OPENROUTER_MODEL');
    if (openRouterModel && !process.env.JOB_DIGEST_OPENROUTER_MODEL) process.env.JOB_DIGEST_OPENROUTER_MODEL = openRouterModel;
    const groqKey = extractEnvValue(raw, 'GROQ_API_KEY');
    if (groqKey && !process.env.GROQ_API_KEY) process.env.GROQ_API_KEY = groqKey;
    const groqModel = extractEnvValue(raw, 'JOB_DIGEST_GROQ_MODEL');
    if (groqModel && !process.env.JOB_DIGEST_GROQ_MODEL) process.env.JOB_DIGEST_GROQ_MODEL = groqModel;
    if (!serviceAccountJson) {
      serviceAccountJson = extractEnvValue(raw, 'FIREBASE_SERVICE_ACCOUNT_JSON');
    }
    const serviceAccountPath = extractEnvValue(raw, 'FIREBASE_SERVICE_ACCOUNT_PATH');
    if (!serviceAccountJson && serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8').trim();
    }
    const serviceAccountB64 = extractEnvValue(raw, 'FIREBASE_SERVICE_ACCOUNT_B64');
    if (!serviceAccountJson && serviceAccountB64) {
      serviceAccountJson = Buffer.from(serviceAccountB64, 'base64').toString('utf8');
    }
  }

  if (!serviceAccountJson) {
    const localServiceAccountPath = path.join(process.cwd(), 'scripts', 'service_account.json');
    if (fs.existsSync(localServiceAccountPath)) {
      serviceAccountJson = fs.readFileSync(localServiceAccountPath, 'utf8').trim();
    }
  }

  if (serviceAccountJson && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
  }
};

const jobId = process.argv[2];
if (!jobId) {
  console.error('Usage: node scripts/generate-live-cv-pack.mjs <jobId>');
  process.exit(1);
}

loadOptionalEnv();

if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
  console.error('No CV generation provider key found in environment or .env files');
  process.exit(1);
}

const runGeneration = async ({ db, job, forcedProvider = '' }) => {
  const previousProvider = process.env.JOB_DIGEST_CV_PROVIDER;
  if (forcedProvider) process.env.JOB_DIGEST_CV_PROVIDER = forcedProvider;
  else delete process.env.JOB_DIGEST_CV_PROVIDER;

  try {
    const tailoredSections = normalizeTailoredCvSections(
      await generateTailoredCvSections({
        db,
        job,
        apiKey: process.env.OPENAI_API_KEY,
      }),
    );
    const baseCvSections = getDefaultBaseCvSections();
    const cvValidation = validateCvVariant({
      baseSections: baseCvSections,
      tailoredSections,
    });
    return { tailoredSections, baseCvSections, cvValidation };
  } finally {
    if (previousProvider) process.env.JOB_DIGEST_CV_PROVIDER = previousProvider;
    else delete process.env.JOB_DIGEST_CV_PROVIDER;
  }
};

const db = getFirestore();
const jobRef = db.collection('jobs').doc(jobId);
const jobDoc = await jobRef.get();
if (!jobDoc.exists) {
  console.error(`Job not found: ${jobId}`);
  process.exit(1);
}
const job = jobDoc.data() || {};
let { tailoredSections, baseCvSections, cvValidation } = await runGeneration({ db, job });

const shouldRetryWithOpenRouter =
  process.env.OPENROUTER_API_KEY &&
  tailoredSections.generated_by_provider !== 'openrouter' &&
  cvValidation.warnings.some((warning) => /generic phrasing|Repeated metrics/i.test(warning));

if (shouldRetryWithOpenRouter) {
  try {
    const openRouterAttempt = await runGeneration({ db, job, forcedProvider: 'openrouter' });
    if (openRouterAttempt.cvValidation.warnings.length < cvValidation.warnings.length) {
      ({ tailoredSections, baseCvSections, cvValidation } = openRouterAttempt);
    }
  } catch (error) {
    // Keep the best available draft if the retry path fails.
  }
}

const answers = {
  fullName: MASTER_CV_SCHEMA.header.full_name,
  email: MASTER_CV_SCHEMA.header.email,
  phone: MASTER_CV_SCHEMA.header.phone,
  location: MASTER_CV_SCHEMA.header.location,
  linkedinUrl: MASTER_CV_SCHEMA.header.linkedin_url,
  portfolioUrl: MASTER_CV_SCHEMA.header.portfolio_items.join(' | '),
};

await jobRef.update({
  tailored_cv_sections: tailoredSections,
  cv_generated_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const writeResult = await writeApplicationPack({
  jobId,
  role: job.role || '',
  company: job.company || '',
  pack: {
    tailoredCvSections: tailoredSections,
    baseCvSections,
    answers,
  },
});

console.log(
  JSON.stringify(
    {
      jobId,
      role: job.role || '',
      company: job.company || '',
      fit_score: job.fit_score || null,
      ats_family: job.ats_family || '',
      source: job.source || '',
      cvValidation,
      output: writeResult,
    },
    null,
    2,
  ),
);
