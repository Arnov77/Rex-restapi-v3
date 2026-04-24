const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config();

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(7860),

  // Tells Express how many proxy hops to trust (affects req.ip and
  // express-rate-limit). Set to an integer (number of hops) or a boolean/
  // string recognised by Express.
  TRUST_PROXY: Joi.alternatives().try(Joi.number().integer().min(0), Joi.string()).default(1),

  // Default body-parser limit for JSON / URL-encoded payloads. Multipart
  // uploads (MIQ avatar) have their own multer limit and are not affected.
  BODY_LIMIT_MB: Joi.number().integer().min(1).max(50).default(1),

  // Playwright-compatible Chromium executable. Supplied by the container
  // image; host installs usually leave it at the default.
  CHROME_BIN: Joi.string().default('/usr/bin/chromium'),

  // Upstream integrations — all optional at boot so the service stays up even
  // when a single provider is missing. Call sites validate presence as needed
  // and fail with 400/502.
  YOUTUBE_COOKIES_B64: Joi.string().allow('').optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  DISCORD_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
  REPLICATE_API_TOKEN: Joi.string().allow('').optional(),

  BEDROCK_PREFIXES: Joi.string().default('.'),
  FILE_IO_API_URL: Joi.string().uri().default('https://tmpfiles.org'),
  API_VERSION: Joi.string().default('2.0.0'),
}).unknown(true);

const { error, value: env } = envSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: false,
});

if (error) {
  console.error('[config] Invalid environment variables:');
  for (const detail of error.details) {
    console.error(`  - ${detail.message}`);
  }
  process.exit(1);
}

module.exports = {
  creator: 'Arnov',
  env,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
};
