const bcrypt = require('bcryptjs');
const usersRepo = require('../../shared/repositories/users.repo');
const apiKeysRepo = require('../../shared/repositories/apiKeys.repo');
const usageRepo = require('../../shared/repositories/usage.repo');
const apiKeysService = require('../auth/apiKeys.service');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError, AppError, UnauthorizedError } = require('../../shared/utils/errors');
const logger = require('../../shared/utils/logger');

const DEFAULT_USER_DAILY_LIMIT = parseInt(process.env.QUOTA_USER_DAILY, 10) || 250;

function nextMidnightIso() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next.toISOString();
}

async function buildUsageView(user, apiKeyRecord) {
  if (!apiKeyRecord || apiKeyRecord.tier === 'master') {
    return { used: 0, limit: null, remaining: null, resetAt: nextMidnightIso(), unlimited: true };
  }
  const limit = apiKeyRecord.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT;
  // Quota is keyed per-user, not per-key — see middleware/dailyQuota.js.
  const used = (await usageRepo.getCount(`user:${user.id}`)) || 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: nextMidnightIso(),
    unlimited: false,
  };
}

function publicApiKeyView(record, plaintext) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    tier: record.tier,
    dailyLimit: record.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT,
    key: plaintext ?? null,
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
  const user = await usersRepo.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const apiKeyRecord = await apiKeysRepo.findById(user.apiKeyId);
  const usage = await buildUsageView(user, apiKeyRecord);
  return ResponseHandler.success(res, {
    user: usersRepo.publicView(user),
    apiKey: publicApiKeyView(apiKeyRecord, null),
    usage,
  });
}

// Returns the plaintext API key after re-confirming the user's password.
async function revealKey(req, res) {
  const { password } = req.validated;

  const user = await usersRepo.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    logger.warn(`[user] Reveal-key denied for "${user.username}" (wrong password)`);
    throw new UnauthorizedError('Password salah');
  }

  const apiKeyRecord = await apiKeysRepo.findById(user.apiKeyId);
  if (!apiKeyRecord) throw new NotFoundError('API key not found');

  const plaintext = await apiKeysService.getPlaintextById(apiKeyRecord.id);
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
  const user = await usersRepo.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const previous = await apiKeysRepo.findById(user.apiKeyId);
  if (previous) await apiKeysService.revokeKey(previous.id);

  let result;
  try {
    result = await apiKeysService.createKey({
      name: user.username,
      tier: 'user',
      dailyLimit: previous?.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT,
    });
  } catch (err) {
    throw new AppError(`Failed to regenerate API key: ${err.message}`, 500);
  }

  // Quota counter is keyed by `user:<userId>` (see middleware/dailyQuota.js),
  // so regenerating the API key already preserves today's usage.
  await usersRepo.updateApiKeyId(user.id, result.record.id);
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
