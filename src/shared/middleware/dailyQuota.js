const crypto = require('crypto');
const usageStore = require('../auth/usageStore');
const apiKeyStore = require('../auth/apiKeyStore');
const usersStore = require('../auth/usersStore');
const ResponseHandler = require('../utils/response');
const { env } = require('../../../config');

const ANON_LIMIT = env.QUOTA_ANON_DAILY;
const USER_LIMIT = env.QUOTA_USER_DAILY;

function hashIp(ip) {
  return crypto
    .createHash('sha256')
    .update(String(ip || ''))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Resolve the counter key for the daily quota bucket.
 *
 * Quota follows the *user*, not the API key — otherwise regenerating a key
 * would reset the daily counter. When the API key is bound to a user record
 * we bucket as `user:<userId>`. Standalone keys with no user (created via
 * /api/admin/keys for partners/services) fall back to `key:<keyId>`.
 * Anonymous traffic is bucketed by hashed IP.
 */
function counterKeyFor(req) {
  if (req.apiKey) {
    const owner = usersStore.findByApiKeyId(req.apiKey.id);
    if (owner) return `user:${owner.id}`;
    return `key:${req.apiKey.id}`;
  }
  return `anon:${hashIp(req.ip)}`;
}

function limitFor(req) {
  if (!req.apiKey) return ANON_LIMIT;
  const record = apiKeyStore.findById(req.apiKey.id);
  if (record && typeof record.dailyLimit === 'number') return record.dailyLimit;
  return USER_LIMIT;
}

function setQuotaHeaders(res, { limit, remaining }) {
  const reset = usageStore.nextLocalMidnight().toISOString();
  res.set('X-Quota-Limit', String(limit));
  res.set('X-Quota-Remaining', String(Math.max(0, remaining)));
  res.set('X-Quota-Reset', reset);
}

/**
 * Per-day request quota that decrements on every successful pre-handler pass.
 *
 * This is the "business" limit (1 hit = 1 quota), distinct from the technical
 * anti-spam burst limiter. Master tier bypasses this entirely; user-tier keys
 * may carry an override `dailyLimit` field; anon callers fall back to the env
 * default. Counters are bucketed in-memory by key id (user) or IP hash (anon)
 * and reset at local midnight by usageStore.
 */
function dailyQuota(req, res, next) {
  if (req.apiKey?.tier === 'master') return next();

  const counterKey = counterKeyFor(req);
  const limit = limitFor(req);
  const used = usageStore.getCount(counterKey);

  if (used >= limit) {
    setQuotaHeaders(res, { limit, remaining: 0 });
    return ResponseHandler.error(
      res,
      `Daily quota exceeded (${used}/${limit}). Quota resets at local midnight.`,
      429
    );
  }

  const next_ = usageStore.increment(counterKey);
  setQuotaHeaders(res, { limit, remaining: limit - next_ });
  return next();
}

module.exports = { dailyQuota, counterKeyFor, limitFor, hashIp };
