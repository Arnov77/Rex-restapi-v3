/**
 * Dedicated brute-force guard for `/api/auth/login`. Backed by Supabase so
 * counters survive restarts and are shared across instances.
 *
 * Two limiters mounted side-by-side:
 *   - per-IP (broad)
 *   - per-identifier (narrow, defeats distributed attacks against one account)
 *
 * Successful logins are NOT credited back (we'd need post-response hooks).
 * Defaults are generous enough that legitimate retries after a typo won't
 * trip the limit before the user gets it right.
 */
const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const { supabaseRateLimit } = require('./supabaseRateLimit');

const IP_MAX = parseInt(process.env.LOGIN_LIMIT_PER_IP, 10) || 10;
const IDENTIFIER_MAX = parseInt(process.env.LOGIN_LIMIT_PER_IDENTIFIER, 10) || 5;
const WINDOW_SEC = 15 * 60;

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

const ipLimiter = supabaseRateLimit({
  prefix: 'login-ip',
  windowSec: WINDOW_SEC,
  max: IP_MAX,
  keyGenerator: (req) => `login-ip:${shortHash(ipKeyGenerator(req.ip))}`,
  message: 'Terlalu banyak percobaan login dari IP ini. Coba lagi dalam 15 menit.',
});

const identifierLimiter = supabaseRateLimit({
  prefix: 'login-id',
  windowSec: WINDOW_SEC,
  max: IDENTIFIER_MAX,
  skip: (req) => typeof req.body?.identifier !== 'string',
  keyGenerator: (req) =>
    `login-id:${shortHash(String(req.body.identifier).toLowerCase().trim())}`,
  message: 'Akun ini terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
});

const loginLimiter = [ipLimiter, identifierLimiter];

module.exports = { loginLimiter, ipLimiter, identifierLimiter, IP_MAX, IDENTIFIER_MAX };
