const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const ResponseHandler = require('../utils/response');

/**
 * Per-IP throttle for `/api/auth/register`.
 *
 * Without this, a single IP can register hundreds of accounts to dodge anon
 * quota or to seed bot accounts. Anti-spam (5 req/sec/IP) is too generous
 * for an account-creation endpoint. Default: 5 successful registrations
 * per hour per IP. Failed (validation / duplicate) registrations also count
 * — a flood of bad attempts is itself the abuse we want to throttle.
 */

const REGISTER_MAX = parseInt(process.env.REGISTER_LIMIT_PER_IP, 10) || 5;
const WINDOW_MS = 60 * 60 * 1000;

const registerLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: REGISTER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `register-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    ResponseHandler.error(
      res,
      'Terlalu banyak percobaan registrasi dari IP ini. Coba lagi dalam 1 jam.',
      429
    ),
});

module.exports = { registerLimiter, REGISTER_MAX };
