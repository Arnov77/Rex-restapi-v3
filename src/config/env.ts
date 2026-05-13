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
  MASTER_API_KEY_BOOTSTRAP: z.string().optional(),

  CORS_ORIGINS: z.string().default('*'),

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
