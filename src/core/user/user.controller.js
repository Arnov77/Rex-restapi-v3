const usersStore = require('../../shared/auth/usersStore');
const apiKeyStore = require('../../shared/auth/apiKeyStore');
const usageStore = require('../../shared/auth/usageStore');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError, AppError } = require('../../shared/utils/errors');
const logger = require('../../shared/utils/logger');

const DEFAULT_USER_DAILY_LIMIT = parseInt(process.env.QUOTA_USER_DAILY, 10) || 250;

function nextMidnightIso() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return next.toISOString();
}

function buildUsageView(apiKeyRecord) {
  if (!apiKeyRecord || apiKeyRecord.tier === 'master') {
    return { used: 0, limit: null, remaining: null, resetAt: nextMidnightIso(), unlimited: true };
  }
  const limit = apiKeyRecord.dailyLimit ?? DEFAULT_USER_DAILY_LIMIT;
  const used = usageStore.getCount(`key:${apiKeyRecord.id}`) || 0;
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

async function profile(req, res) {
  const user = usersStore.findById(req.user.id);
  if (!user) throw new NotFoundError('User no longer exists');

  const apiKeyRecord = apiKeyStore.findById(user.apiKeyId);
  return ResponseHandler.success(res, {
    user: usersStore.publicView(user),
    apiKey: publicApiKeyView(apiKeyRecord, true),
    usage: buildUsageView(apiKeyRecord),
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

  // Carry today's quota usage from the old key id onto the new one so users
  // can't reset their daily counter by regenerating. Quota is per-user-per-day,
  // not per-key-per-day.
  if (previous) {
    usageStore.transfer(`key:${previous.id}`, `key:${result.record.id}`);
  }

  usersStore.updateApiKeyId(user.id, result.record.id);
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

module.exports = { profile, regenerateKey };
