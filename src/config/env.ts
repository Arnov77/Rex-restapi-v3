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

  CORS_ORIGINS: z.string().default('*'),

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

  // Optional override for Chromium executable path (Playwright will use its
  // bundled binary when omitted).
  CHROME_BIN: z.string().optional(),
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
