const apiKeyStore = require('../../shared/auth/apiKeyStore');
const usageStore = require('../../shared/auth/usageStore');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError } = require('../../shared/utils/errors');
const { env } = require('../../../config');

async function listKeys(req, res) {
  const keys = apiKeyStore.listKeys();
  return ResponseHandler.success(res, { keys, total: keys.length }, 'API keys listed', 200);
}

async function createKey(req, res) {
  const { name, tier, dailyLimit } = req.validated;
  const { plaintext, record } = apiKeyStore.createKey({ name, tier, dailyLimit });
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
  const record = apiKeyStore.updateKey(id, req.validated);
  if (!record) throw new NotFoundError('API key not found');
  return ResponseHandler.success(res, record, 'API key updated', 200);
}

async function revokeKey(req, res) {
  const { id } = req.params;
  const record = apiKeyStore.revokeKey(id);
  if (!record) throw new NotFoundError('API key not found');
  return ResponseHandler.success(res, record, 'API key revoked', 200);
}

/**
 * Snapshot of today's daily-quota counters. Joins each `key:<id>` counter
 * with its API-key record so admins can see name + dailyLimit alongside the
 * `used` count. Anonymous counters are returned as IP-hash buckets.
 */
async function getUsage(req, res) {
  const { date, counters } = usageStore.snapshot();
  const keyRecordsById = new Map(apiKeyStore.listKeys().map((k) => [k.id, k]));

  const enriched = Object.entries(counters).map(([counterKey, used]) => {
    if (counterKey.startsWith('key:')) {
      const id = counterKey.slice(4);
      const record = keyRecordsById.get(id);
      return {
        scope: 'key',
        id,
        name: record?.name ?? null,
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
      resetAt: usageStore.nextLocalMidnight().toISOString(),
      totalCalls,
      counters: enriched,
    },
    'Usage snapshot',
    200
  );
}

module.exports = { listKeys, createKey, updateKey, revokeKey, getUsage };
