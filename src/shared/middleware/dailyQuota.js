const crypto = require('crypto');
const usageRepo = require('../repositories/usage.repo');
const apiKeysRepo = require('../repositories/apiKeys.repo');
const usersRepo = require('../repositories/users.repo');
const ResponseHandler = require('../utils/response');
const logger = require('../utils/logger');
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
 * Resolve the counter key for the daily quota bucket. Quota follows the
 * *user*, not the API key — otherwise regenerating a key would reset the
 * counter. Standalone keys (no user binding) bucket as `key:<keyId>`.
 * Anonymous traffic buckets by hashed IP.
 */
async function counterKeyFor(req) {
  if (req.apiKey) {
    const owner = await usersRepo.findByApiKeyId(req.apiKey.id);
    if (owner) return `user:${owner.id}`;
    return `key:${req.apiKey.id}`;
  }
  return `anon:${hashIp(req.ip)}`;
}

async function limitFor(req) {
  if (!req.apiKey) return ANON_LIMIT;
  const record = await apiKeysRepo.findById(req.apiKey.id);
  if (record && typeof record.dailyLimit === 'number') return record.dailyLimit;
  return USER_LIMIT;
}

function setQuotaHeaders(res, { limit, remaining }) {
  res.set('X-Quota-Limit', String(limit));
  res.set('X-Quota-Remaining', String(Math.max(0, remaining)));
  res.set('X-Quota-Reset', usageRepo.nextLocalMidnight().toISOString());
}

/**
 * Per-day request quota. Atomic via Supabase RPC — race-free under burst
 * concurrency. Master tier bypasses entirely (no DB round-trip). Failures
 * fail-open with a warning log so a transient DB outage doesn't 5xx every
 * single request — adjust if you'd rather fail-closed.
 */
async function dailyQuota(req, res, next) {
  if (req.apiKey?.tier === 'master') return next();

  try {
    const [counterKey, limit] = await Promise.all([counterKeyFor(req), limitFor(req)]);
    const { allowed, used, limit: appliedLimit } = await usageRepo.checkAndIncrement(
      counterKey,
      limit
    );
    setQuotaHeaders(res, { limit: appliedLimit, remaining: appliedLimit - used });
    if (!allowed) {
      return ResponseHandler.error(
        res,
        `Daily quota exceeded (${used}/${appliedLimit}). Quota resets at local midnight.`,
        429
      );
    }
    return next();
  } catch (err) {
    logger.error(`[quota] check failed (fail-open): ${err.message}`);
    return next();
  }
}

module.exports = { dailyQuota, counterKeyFor, limitFor, hashIp };
