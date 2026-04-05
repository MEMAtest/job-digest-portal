const OpenAI = require("openai");
const { toFile } = require("openai");

const OPENAI_PREP_MODEL = process.env.OPENAI_PREP_MODEL || "gpt-4o";
const OPENROUTER_MODEL = process.env.JOB_DIGEST_OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
const GROQ_MODEL = process.env.JOB_DIGEST_GROQ_MODEL || "llama-3.3-70b-versatile";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
const GROQ_TRANSCRIPTION_MODEL = process.env.JOB_DIGEST_GROQ_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const buildTextProviders = () => {
  const forcedProvider = String(process.env.JOB_DIGEST_PREP_PROVIDER || "").trim().toLowerCase();
  const providers = [];

  if (process.env.GROQ_API_KEY && (!forcedProvider || forcedProvider === "groq")) {
    providers.push({
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: GROQ_MODEL,
      clientOptions: {
        baseURL: GROQ_BASE_URL,
      },
    });
  }

  if (process.env.OPENROUTER_API_KEY && (!forcedProvider || forcedProvider === "openrouter")) {
    providers.push({
      name: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      clientOptions: {
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer": process.env.SITE_URL || "https://adejob.netlify.app",
          "X-Title": "job-digest-portal-prep",
        },
      },
    });
  }

  if (process.env.OPENAI_API_KEY && (!forcedProvider || forcedProvider === "openai")) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: OPENAI_PREP_MODEL,
      clientOptions: {},
    });
  }

  return providers;
};

const buildTranscriptionProviders = () => {
  const forcedProvider = String(process.env.JOB_DIGEST_PREP_TRANSCRIPTION_PROVIDER || "").trim().toLowerCase();
  const providers = [];

  if (process.env.GROQ_API_KEY && (!forcedProvider || forcedProvider === "groq")) {
    providers.push({
      name: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: GROQ_TRANSCRIPTION_MODEL,
      clientOptions: {
        baseURL: GROQ_BASE_URL,
      },
    });
  }

  if (process.env.OPENAI_API_KEY && (!forcedProvider || forcedProvider === "openai")) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: OPENAI_TRANSCRIPTION_MODEL,
      clientOptions: {},
    });
  }

  return providers;
};

const createClient = (provider) =>
  new OpenAI({
    apiKey: provider.apiKey,
    ...provider.clientOptions,
  });

const generateTextWithProvider = async ({ provider, prompt, temperature = 0.3, maxTokens = 5000 }) => {
  const client = createClient(provider);
  const response = await client.chat.completions.create({
    model: provider.model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });
  const text = response.choices[0]?.message?.content || "";
  if (!text) {
    throw new Error(`No response content from ${provider.name}`);
  }
  return text;
};

const transcribeAudioWithProvider = async ({
  provider,
  buffer,
  fileName = "interview.m4a",
  mimeType = "audio/mp4",
  language = "en",
}) => {
  const client = createClient(provider);
  const audioFile = await toFile(buffer, fileName, { type: mimeType });
  const result = await client.audio.transcriptions.create({
    file: audioFile,
    model: provider.model,
    language,
  });
  const text = result?.text || "";
  if (!text) {
    throw new Error(`No transcription text from ${provider.name}`);
  }
  return text;
};

module.exports = {
  buildTextProviders,
  buildTranscriptionProviders,
  generateTextWithProvider,
  transcribeAudioWithProvider,
};
