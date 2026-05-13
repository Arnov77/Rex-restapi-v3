const apiKeysRepo = require('../../shared/repositories/apiKeys.repo');
const usageRepo = require('../../shared/repositories/usage.repo');
const usersRepo = require('../../shared/repositories/users.repo');
const apiKeysService = require('../auth/apiKeys.service');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError } = require('../../shared/utils/errors');
const { env } = require('../../../config');

async function listKeys(req, res) {
  const records = await apiKeysRepo.listKeys();
  const keys = records.map(apiKeysRepo.publicView);
  return ResponseHandler.success(res, { keys, total: keys.length }, 'API keys listed', 200);
}

async function createKey(req, res) {
  const { name, tier, dailyLimit } = req.validated;
  const { plaintext, record } = await apiKeysService.createKey({ name, tier, dailyLimit });
  return ResponseHandler.success(
    res,
    {
      ...record,
      key: plaintext,
      warning: 'Store this key now. The plaintext value will not be shown again.',
    },
    'API key created',
    201
  );
}

async function updateKey(req, res) {
  const { id } = req.params;
  const existing = await apiKeysRepo.findById(id);
  if (!existing) throw new NotFoundError('API key not found');
  const record = await apiKeysService.updateKey(id, req.validated);
  return ResponseHandler.success(res, record, 'API key updated', 200);
}

async function revokeKey(req, res) {
  const { id } = req.params;
  const record = await apiKeysService.revokeKey(id);
  if (!record) throw new NotFoundError('API key not found');
  return ResponseHandler.success(res, record, 'API key revoked', 200);
}

/**
 * Snapshot of today's daily-quota counters joined with API-key + user data
 * so admins can see name + dailyLimit alongside the `used` count.
 */
async function getUsage(req, res) {
  const [{ date, counters }, allKeys] = await Promise.all([
    usageRepo.snapshot(),
    apiKeysRepo.listKeys(),
  ]);
  const keyRecordsById = new Map(allKeys.map((k) => [k.id, k]));

  // Pre-resolve owners for the userIds and keyIds we'll need, in parallel.
  const userIds = [];
  const keyIds = [];
  for (const counterKey of Object.keys(counters)) {
    if (counterKey.startsWith('user:')) userIds.push(counterKey.slice(5));
    else if (counterKey.startsWith('key:')) keyIds.push(counterKey.slice(4));
  }
  const [usersById, ownersByKeyId] = await Promise.all([
    Promise.all(userIds.map((id) => usersRepo.findById(id))).then((rows) =>
      new Map(rows.filter(Boolean).map((u) => [u.id, u]))
    ),
    Promise.all(keyIds.map((id) => usersRepo.findByApiKeyId(id))).then((rows) =>
      new Map(rows.filter(Boolean).map((u) => [u.apiKeyId, u]))
    ),
  ]);

  const enriched = Object.entries(counters).map(([counterKey, used]) => {
    if (counterKey.startsWith('user:')) {
      const userId = counterKey.slice(5);
      const owner = usersById.get(userId);
      const record = owner ? keyRecordsById.get(owner.apiKeyId) : null;
      return {
        scope: 'user',
        id: userId,
        name: record?.name ?? null,
        username: owner?.username ?? null,
        email: owner?.email ?? null,
        used,
        limit: record?.dailyLimit ?? env.QUOTA_USER_DAILY,
        revoked: record?.revoked ?? false,
      };
    }
    if (counterKey.startsWith('key:')) {
      const id = counterKey.slice(4);
      const record = keyRecordsById.get(id);
      const owner = ownersByKeyId.get(id);
      return {
        scope: 'key',
        id,
        name: record?.name ?? null,
        username: owner?.username ?? null,
        email: owner?.email ?? null,
        used,
        limit: record?.dailyLimit ?? env.QUOTA_USER_DAILY,
        revoked: record?.revoked ?? false,
      };
    }
    if (counterKey.startsWith('anon:')) {
      return {
        scope: 'anon',
        id: counterKey.slice(5),
        name: null,
        used,
        limit: env.QUOTA_ANON_DAILY,
      };
    }
    return { scope: 'unknown', id: counterKey, used };
  });

  enriched.sort((a, b) => b.used - a.used);
  const totalCalls = enriched.reduce((sum, entry) => sum + entry.used, 0);

  return ResponseHandler.success(
    res,
    {
      date,
      resetAt: usageRepo.nextLocalMidnight().toISOString(),
      totalCalls,
      counters: enriched,
    },
    'Usage snapshot',
    200
  );
}

module.exports = { listKeys, createKey, updateKey, revokeKey, getUsage };
