const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const ResponseHandler = require('../utils/response');
const { env } = require('../../../config');

/**
 * Burst guard against flooding/DDoS. Applies to **every** caller — including
 * master-tier keys — because its purpose is server protection, not business
 * quota enforcement. The daily quota middleware handles tier-based usage.
 *
 * Window is 1 second. The cap is per-IP (IPv6 bucketed by /56 via the
 * `ipKeyGenerator` helper, which is mandatory in express-rate-limit v8 when
 * the keyGenerator references req.ip).
 */
const antiSpamLimiter = rateLimit({
  windowMs: 1000,
  max: env.ANTI_SPAM_PER_SECOND,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  // Skip docs: a single page-load fans out into swagger-ui assets +
  // /api/docs.json + the binary-patch's own spec fetch, which legitimately
  // exceeds the per-second cap. Docs are static and harmless to flood.
  skip: (req) => req.path === '/api/docs.json' || req.path.startsWith('/api/docs'),
  handler: (req, res) =>
    ResponseHandler.error(res, 'Too many requests per second. Slow down.', 429),
});

module.exports = { antiSpamLimiter };
