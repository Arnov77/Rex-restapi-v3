const dotenv = require('dotenv');
const fs = require('fs');
const Joi = require('joi');

dotenv.config();

// Chromium path auto-detect. When CHROME_BIN is not set, probe common install
// locations in priority order: Snap (Ubuntu 24.04+), apt/debian, legacy apt,
// Google Chrome. If nothing exists, fall through to the Docker image default
// — Playwright will surface a clear error at launch.
function resolveChromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore probe errors */
    }
  }
  return '/usr/bin/chromium';
}
process.env.CHROME_BIN = resolveChromeBin();

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
  // Override the in-code fallback chain. Accepts any comma-separated list of
  // yt-dlp player client names (e.g. 'android,web' or
  // 'default,tv,web,android'). Empty/unset uses the in-code default chain.
  YOUTUBE_PLAYER_CLIENT: Joi.string()
    .pattern(/^[a-z0-9_,]+$/i)
    .allow('')
    .optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  DISCORD_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
  REPLICATE_API_TOKEN: Joi.string().allow('').optional(),

  BEDROCK_PREFIXES: Joi.string().default('.'),
  FILE_IO_API_URL: Joi.string().uri().default('https://tmpfiles.org'),
  API_VERSION: Joi.string().default('2.0.0'),

  // Pino log level. When unset, server falls back to 'debug' in dev and
  // 'info' in prod (see src/shared/utils/logger.js).
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .optional(),
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
