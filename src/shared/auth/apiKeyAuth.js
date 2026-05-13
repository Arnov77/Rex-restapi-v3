const apiKeysService = require('../../core/auth/apiKeys.service');
const ResponseHandler = require('../utils/response');

const { KEY_PREFIX } = apiKeysService;

/**
 * Extract a plaintext API key from the request. Honours the dedicated
 * `X-API-Key` header first; falls back to `Authorization: Bearer <key>`
 * BUT only when the value looks like an API key (starts with `rex_`). The
 * latter check is what lets `Authorization: Bearer <jwt>` coexist with API
 * keys on the same header — non-rex_ Bearer values fall through to the JWT
 * middleware on protected dashboard routes.
 */
function extractKey(req) {
  const direct = req.get('x-api-key');
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const auth = req.get('authorization');
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim()) {
      const value = match[1].trim();
      if (value.startsWith(KEY_PREFIX)) return value;
    }
  }
  return null;
}

/**
 * Resolve the request to one of three tiers:
 *   - anon   (no key supplied; allowed but rate-limited tighter)
 *   - user   (valid non-master key)
 *   - master (valid master key; bypasses limits, can call /api/admin)
 *
 * Invalid / revoked keys hard-fail with 401 — never silently downgrade to
 * anon, otherwise a typo in client config would look like a quota issue.
 */
async function apiKeyAuth(req, res, next) {
  const supplied = extractKey(req);
  if (!supplied) {
    req.apiKey = null;
    return next();
  }

  if (!supplied.startsWith(KEY_PREFIX)) {
    return ResponseHandler.error(res, 'Invalid API key format', 401);
  }

  let verified;
  try {
    verified = await apiKeysService.verifyPlaintextKey(supplied);
  } catch {
    // Verification needs the DB; fail-closed here would lock everyone out
    // on a transient outage. Treat as anon and let downstream quota decide.
    req.apiKey = null;
    return next();
  }
  if (!verified) {
    return ResponseHandler.error(res, 'Invalid or revoked API key', 401);
  }

  req.apiKey = verified;
  apiKeysService.touchKey(verified.id); // fire-and-forget
  return next();
}

function requireMaster(req, res, next) {
  if (req.apiKey?.tier !== 'master') {
    return ResponseHandler.error(res, 'Master API key required', 403);
  }
  return next();
}

module.exports = { apiKeyAuth, requireMaster, extractKey };
