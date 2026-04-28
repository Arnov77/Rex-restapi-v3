const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const ResponseHandler = require('../utils/response');

const buildHandler = (message) => (req, res) => ResponseHandler.error(res, message, 429);

/**
 * Build an express-rate-limit middleware that scales with the requester's
 * API-key tier set by `apiKeyAuth`:
 *   - master tier: skipped entirely (unlimited)
 *   - user tier:   `userMax` per window, scoped per key id
 *   - anon:        `anonMax` per window, scoped per IP (IPv6-subnet aware)
 *
 * Tiers share a window and message but have independent quotas because the
 * `keyGenerator` returns different identifiers. The IP branch routes through
 * `ipKeyGenerator()` so IPv6 clients get bucketed by /56 prefix instead of
 * full address (otherwise express-rate-limit v8 throws ERR_ERL_KEY_GEN_IPV6).
 */
function tieredLimiter({ anonMax, userMax, windowMs = 60 * 1000, message }) {
  return rateLimit({
    windowMs,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.apiKey?.tier === 'master',
    keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : `ip:${ipKeyGenerator(req.ip)}`),
    max: (req) => (req.apiKey?.tier === 'user' ? userMax : anonMax),
    handler: buildHandler(message || 'Rate limit exceeded for your tier.'),
  });
}

const tieredApiLimiter = tieredLimiter({
  anonMax: 30,
  userMax: 120,
  message: 'Too many requests to this endpoint, please slow down.',
});

const tieredHeavyLimiter = tieredLimiter({
  anonMax: 10,
  userMax: 30,
  message: 'Too many heavy requests, please slow down.',
});

const tieredAiLimiter = tieredLimiter({
  anonMax: 10,
  userMax: 50,
  windowMs: 60 * 60 * 1000,
  message: 'AI endpoint hourly quota reached, try again later.',
});

module.exports = {
  tieredLimiter,
  tieredApiLimiter,
  tieredHeavyLimiter,
  tieredAiLimiter,
};
