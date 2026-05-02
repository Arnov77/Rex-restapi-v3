const bcrypt = require('bcryptjs');
const usersStore = require('../../shared/auth/usersStore');
const apiKeyStore = require('../../shared/auth/apiKeyStore');
const usageStore = require('../../shared/auth/usageStore');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError, AppError, UnauthorizedError } = require('../../shared/utils/errors');
const logger = require('../../shared/utils/logger');

const DEFAULT_USER_DAILY_LIMIT = parseInt(process.env.QUOTA_USER_DAILY, 10) || 250;

function nextMidnightIso() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next.toISOString();
}

function buildUsageView(user, apiKeyRecord) {
  if (!apiKeyRecord || apiKeyRecord.tier === 'master') {
    return { used: 0, limit: null, remaining: null, resetAt: nextMidnightIso(), unlimited: true };
  }
  const limit = apiKeyRecord.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT;
  // Quota is keyed per-user, not per-key — see middleware/dailyQuota.js.
  const used = usageStore.getCount(`user:${user.id}`) || 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: nextMidnightIso(),
    unlimited: false,
  };
}

function publicApiKeyView(record, includePlaintext) {
  if (!record) return null;
  const plaintext = includePlaintext ? apiKeyStore.getPlaintextById(record.id) : null;
  return {
    id: record.id,
    name: record.name,
    tier: record.tier,
    dailyLimit: record.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT,
    key: plaintext,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
    revoked: !!record.revoked,
  };
}

// /api/user/profile is polled every 30s by the dashboard for live quota
// updates. Returning plaintext on every call means a stolen JWT alone is
// enough to leak the API key — so plaintext is NEVER included here. Use
// /api/user/reveal-key (password re-auth) or read the cached value from the
// login/register/regenerate response on the client.
async function profile(req, res) {
  const user = usersStore.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const apiKeyRecord = apiKeyStore.findById(user.apiKeyId);
  return ResponseHandler.success(res, {
    user: usersStore.publicView(user),
    apiKey: publicApiKeyView(apiKeyRecord, false),
    usage: buildUsageView(user, apiKeyRecord),
  });
}

// Returns the plaintext API key after re-confirming the user's password.
// This is the recovery path when the client's localStorage cache was
// cleared but the JWT is still valid — without this endpoint the user
// would have to regenerate (and invalidate) their key just to see it.
async function revealKey(req, res) {
  const { password } = req.validated;

  const user = usersStore.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    logger.warn(`[user] Reveal-key denied for "${user.username}" (wrong password)`);
    throw new UnauthorizedError('Password salah');
  }

  const apiKeyRecord = apiKeyStore.findById(user.apiKeyId);
  if (!apiKeyRecord) {
    throw new NotFoundError('API key not found');
  }

  const plaintext = apiKeyStore.getPlaintextById(apiKeyRecord.id);
  if (!plaintext) {
    throw new AppError('Plaintext key tidak tersedia di server. Silakan regenerate.', 410);
  }

  logger.info(`[user] Revealed API key for "${user.username}"`);
  return ResponseHandler.success(res, {
    apiKey: {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      tier: apiKeyRecord.tier,
      dailyLimit: apiKeyRecord.dailyLimit,
      key: plaintext,
      createdAt: apiKeyRecord.createdAt,
    },
  });
}

async function regenerateKey(req, res) {
  const user = usersStore.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const previous = apiKeyStore.findById(user.apiKeyId);
  if (previous) apiKeyStore.revokeKey(previous.id);

  let result;
  try {
    result = apiKeyStore.createKey({
      name: user.username,
      tier: 'user',
      dailyLimit: previous?.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT,
    });
  } catch (err) {
    throw new AppError(`Failed to regenerate API key: ${err.message}`, 500);
  }

  // Quota counter is keyed by `user:<userId>` (see middleware/dailyQuota.js),
  // so regenerating the API key already preserves today's usage — no
  // transfer needed. Any stale `key:<id>` entries from older deployments are
  // garbage-collected at midnight reset.
  usersStore.updateApiKeyId(user.id, result.record.id);
  try {
    await Promise.all([apiKeyStore.persistNow(), usersStore.persistNow()]);
  } catch (err) {
    logger.error(`[user] Failed to persist regenerated key for "${user.username}": ${err.message}`);
    throw new AppError('Failed to persist regenerated API key', 500);
  }
  logger.info(
    `[user] Regenerated API key for "${user.username}" (revoked ${previous?.id || 'none'})`
  );

  return ResponseHandler.success(
    res,
    {
      apiKey: {
        id: result.record.id,
        name: result.record.name,
        tier: result.record.tier,
        dailyLimit: result.record.dailyLimit,
        key: result.plaintext,
        createdAt: result.record.createdAt,
      },
    },
    'API key regenerated'
  );
}

module.exports = { profile, regenerateKey, revealKey };
