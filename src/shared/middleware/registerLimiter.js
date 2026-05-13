/**
 * Per-IP throttle for `/api/auth/register`. Backed by Supabase so the
 * counter survives restarts and is shared across instances.
 */
const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const { supabaseRateLimit } = require('./supabaseRateLimit');

const REGISTER_MAX = parseInt(process.env.REGISTER_LIMIT_PER_IP, 10) || 5;
const WINDOW_SEC = 60 * 60;

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

const registerLimiter = supabaseRateLimit({
  prefix: 'register-ip',
  windowSec: WINDOW_SEC,
  max: REGISTER_MAX,
  keyGenerator: (req) => `register-ip:${shortHash(ipKeyGenerator(req.ip))}`,
  message: 'Terlalu banyak percobaan registrasi dari IP ini. Coba lagi dalam 1 jam.',
});

module.exports = { registerLimiter, REGISTER_MAX };
