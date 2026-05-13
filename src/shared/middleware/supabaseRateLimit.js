/**
 * Persistent rate-limit middleware factory. Backed by Supabase RPC so the
 * counter survives restarts and is shared across instances.
 *
 * Fail-open: if the RPC errors (DB outage, network), the request is
 * allowed through with a warning log. A login outage is preferable to
 * locking everyone out — adjust to fail-closed if your threat model differs.
 *
 * Options:
 *   - keyGenerator(req): string  → bucket key (e.g. `login-ip:<hash>`).
 *   - windowSec: number          → window length in seconds.
 *   - max: number                → max requests per window.
 *   - message: string            → response body when rejected.
 *   - skip(req): boolean         → optional bypass predicate.
 *   - prefix: string             → label for logs.
 */
const ResponseHandler = require('../utils/response');
const logger = require('../utils/logger');
const rateLimitRepo = require('../repositories/rateLimit.repo');

function supabaseRateLimit({
  keyGenerator,
  windowSec,
  max,
  message,
  skip,
  prefix = 'rate-limit',
}) {
  return async function rateLimitMiddleware(req, res, next) {
    if (typeof skip === 'function' && skip(req)) return next();
    let key;
    try {
      key = keyGenerator(req);
    } catch (err) {
      logger.warn(`[${prefix}] keyGenerator threw (fail-open): ${err.message}`);
      return next();
    }
    if (!key) return next();

    try {
      const { allowed, count, resetAt } = await rateLimitRepo.hit(key, windowSec, max);
      // Mimic standard RFC headers so clients can react to throttling.
      res.set('RateLimit-Limit', String(max));
      res.set('RateLimit-Remaining', String(Math.max(0, max - count)));
      res.set('RateLimit-Reset', String(Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))));
      if (!allowed) {
        return ResponseHandler.error(res, message || 'Too many requests', 429);
      }
      return next();
    } catch (err) {
      logger.warn(`[${prefix}] hit failed (fail-open): ${err.message}`);
      return next();
    }
  };
}

module.exports = { supabaseRateLimit };
