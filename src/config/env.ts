import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Encryption key for storing API keys at rest (32-byte hex => 64 chars)
  API_KEY_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'API_KEY_ENC_KEY must be 64 hex chars (32 bytes)'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Bootstrap master API key (plaintext) — only used the first time the
  // server starts to provision the master key in DB. Optional after that.
  // Must start with `rex_` and be at least 16 chars after the prefix to
  // match the format produced by generatePlaintextKey().
  // Empty string is treated as "unset" so an empty entry in .env is OK.
  MASTER_API_KEY_BOOTSTRAP: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(
      z
        .string()
        .regex(
          /^rex_[A-Za-z0-9_-]{16,}$/,
          'MASTER_API_KEY_BOOTSTRAP must look like "rex_<base64url>" (32+ bytes recommended)',
        )
        .optional(),
    ),

  CORS_ORIGINS: z.string().default(''),

  // Trust proxy whitelist for X-Forwarded-* headers. Accepts:
  //   - "loopback,linklocal,uniquelocal" (default; safe for nginx/docker/CF in front)
  //   - explicit IPs/CIDRs ("10.0.0.0/8,127.0.0.1")
  //   - "*" → trust every hop (ONLY safe when nothing public-facing reaches Fastify directly)
  // The default avoids spoofed `X-Forwarded-For` from arbitrary clients —
  // if a request arrives from a private/loopback peer (your reverse proxy)
  // its forwarded header is honoured; otherwise req.ip stays the real socket IP.
  TRUSTED_PROXIES: z.string().default('loopback,linklocal,uniquelocal'),

  // Default daily quota for anon (no API key) requests, per IP.
  ANON_DAILY_QUOTA: z.coerce.number().int().nonnegative().default(100),
  // Default daily quota for normal user keys (override per-key in DB).
  USER_DAILY_QUOTA: z.coerce.number().int().nonnegative().default(1000),

  // ── Auth hot-path cache (in-process) ─────────────────────────────────────
  // How long (seconds) a validated API-key record is memoised so repeat
  // requests from the same key skip the per-request DB lookup. Short by
  // design: revocations/updates apply immediately on the issuing instance
  // (cache is invalidated there) and converge within this window elsewhere.
  // Set 0 to disable record caching.
  API_KEY_CACHE_TTL_SEC: z.coerce.number().int().min(0).default(30),
  // Max distinct API-key records held in the in-process auth cache.
  API_KEY_CACHE_MAX: z.coerce.number().int().min(1).default(5000),
  // Throttle window (seconds) for `last_used_at` writes per key — collapses
  // the per-request UPDATE into at most one write per key per window. Set 0
  // to write on every request (legacy behaviour).
  API_KEY_TOUCH_THROTTLE_SEC: z.coerce.number().int().min(0).default(60),
  
    API_KEY_REVEALABLE: z
    .string()
    .default('true')
    .transform((v) => !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase())),

  // Optional override for Chromium executable path (Playwright will use its
  // bundled binary when omitted).
  CHROME_BIN: z.string().optional(),

  // Page pool sizing. Each slot is a persistent BrowserContext that gets
  // recycled between requests (cookies cleared, no page leaks). More slots
  // = more concurrent renders = more RAM. 4 is a safe default for a 1-GiB
  // container; bump to 8 on 2-GiB+.
  PAGE_POOL_SIZE: z.coerce.number().int().min(1).max(32).default(4),

  // How long a request waits for a free pool slot before 503-ing.
  // Keep this shorter than the client's visible timeout (Fastify default
  // body timeout is 30s) so users see a meaningful "server busy" rather
  // than a generic gateway timeout.
  PAGE_POOL_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  // Optional override for the static landing page directory. Defaults to
  // `process.cwd() + '/public'`. Set this when running the binary from a
  // path other than the project root (e.g., a packaged container that
  // copies dist/ to `/app/dist` and public/ to `/app/public`).
  STATIC_DIR: z.string().optional(),
  
  SHORTLINK_BASE_URL: z
    .string()
    .url()
    .transform((s) => s.replace(/\/+$/, ''))
    .optional(),

  // Download proxy: TTL for signed proxy tokens (seconds). Default 1 hour.
  DOWNLOAD_PROXY_TTL_SEC: z.coerce.number().int().min(60).default(3600),
  DOWNLOAD_PROXY_SECRET: z
    .string()
    .min(32, 'DOWNLOAD_PROXY_SECRET must be at least 32 chars')
    .optional(),

  // Download proxy: max bytes to stream. Default 100MB. Prevents abuse.
  DOWNLOAD_MAX_BYTES: z.coerce.number().int().min(1024).default(104_857_600),

  // Cobalt API URL for Instagram/YouTube downloads. Default uses the public
  // instance (rate-limited + bot-protected). Self-host for reliability:
  //   docker run -d -p 9000:9000 ghcr.io/imputnet/cobalt:latest
  // Then set COBALT_API_URL=http://localhost:9000/
  COBALT_API_URL: z.string().url().default('https://api.cobalt.tools/'),
  
  // Extra hostnames the signed download proxy may stream from even if they
  // resolve to private/loopback IPs (self-hosted media helpers). The
  // COBALT_API_URL host is allowed automatically. Comma-separated.
  DOWNLOAD_PROXY_ALLOW_HOSTS: z.string().optional().default(''),

  // Path to yt-dlp cookies file (Netscape format). Used as fallback for
  // YouTube downloads when cobalt fails. Relative to cwd or absolute path.
  YTDLP_COOKIES_PATH: z.string().default('./cookies.txt'),
  YTDLP_PROXY_URL: z.string().optional(),
  GEMINI_API_KEYS: z.string().optional(), // comma-separated, contoh: key1,key2,key3
  GROQ_API_KEYS: z.string().optional(),   // comma-separated, contoh: key1,key2,key3
  TOKENROUTER_API_KEYS: z.string().optional(),
  GEOIP_CITY_DB: z.string().default('./GeoLite2-City.mmdb'),
  GEOIP_ASN_DB: z.string().default('./GeoLite2-ASN.mmdb'),
  SERPAPI_KEYS: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  SIGHTENGINE_API_USER: z.string().optional(),
  SIGHTENGINE_API_SECRET: z.string().optional(),
  CF_WORKER_URL: z.string().url().optional(),     // URL Cloudflare Worker image generator
  CF_WORKER_API_KEY: z.string().optional(),       // API key untuk Cloudflare Worker
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  
  POOF_API_KEYS: z.string().optional(),
  POOF_API_KEY: z.string().optional(),
  REMOVEBG_API_KEY: z.string().optional(),
  HF_TOKENS: z.string().optional(),

  DEEZLOAD_INTERNAL_URL: z.string().optional(),
  DEEZLOAD_INTERNAL_SECRET: z.string().optional(),
  DEEZLOAD_DOWNLOAD_DIR: z.string().optional(),
    
  AUDIO_LOUDNESS_FILTER: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Pretty-print so misconfig is obvious in logs.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  _env = parsed.data;
  return _env;
}