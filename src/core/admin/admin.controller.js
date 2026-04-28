const apiKeyStore = require('../../shared/auth/apiKeyStore');
const ResponseHandler = require('../../shared/utils/response');
const { NotFoundError } = require('../../shared/utils/errors');

async function listKeys(req, res) {
  const keys = apiKeyStore.listKeys();
  return ResponseHandler.success(res, { keys, total: keys.length }, 'API keys listed', 200);
}

async function createKey(req, res) {
  const { name, tier } = req.validated;
  const { plaintext, record } = apiKeyStore.createKey({ name, tier });
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

async function revokeKey(req, res) {
  const { id } = req.params;
  const record = apiKeyStore.revokeKey(id);
  if (!record) {
    throw new NotFoundError('API key not found');
  }
  return ResponseHandler.success(res, record, 'API key revoked', 200);
}

module.exports = { listKeys, createKey, revokeKey };
