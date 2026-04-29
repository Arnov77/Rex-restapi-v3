const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const ResponseHandler = require('../utils/response');

/**
 * Dedicated brute-force guard for `/api/auth/login`.
 *
 * The global `antiSpamLimiter` (5 req/sec/IP) is too generous for a credential
 * endpoint — at that rate a botnet can mount ~7 200 password attempts per IP
 * per day. This limiter applies a tight sliding window (per-IP) AND a second,
 * narrower window keyed on the supplied identifier (email/username) so that
 * even a distributed attack against a single account hits a hard ceiling.
 *
 * Successful logins do NOT consume the budget — `skipSuccessfulRequests=true`
 * means a legitimate user retrying after a typo isn't punished. Both limiters
 * are mounted side-by-side; either tripping returns 429.
 */

const IP_MAX = parseInt(process.env.LOGIN_LIMIT_PER_IP, 10) || 10;
const IDENTIFIER_MAX = parseInt(process.env.LOGIN_LIMIT_PER_IDENTIFIER, 10) || 5;
const WINDOW_MS = 15 * 60 * 1000;

const ipLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    ResponseHandler.error(
      res,
      'Terlalu banyak percobaan login dari IP ini. Coba lagi dalam 15 menit.',
      429
    ),
});

const identifierLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: IDENTIFIER_MAX,
  standardHeaders: false,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Only enforce when the request body contains a string identifier; if a
  // caller sends garbage we let the validation layer reject it instead.
  skip: (req) => typeof req.body?.identifier !== 'string',
  keyGenerator: (req) => `login-id:${String(req.body.identifier).toLowerCase().trim()}`,
  handler: (req, res) =>
    ResponseHandler.error(
      res,
      'Akun ini terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
      429
    ),
});

const loginLimiter = [ipLimiter, identifierLimiter];

module.exports = { loginLimiter, ipLimiter, identifierLimiter, IP_MAX, IDENTIFIER_MAX };
