const { verifyKey, touchKey, KEY_PREFIX } = require('./apiKeyStore');
const ResponseHandler = require('../utils/response');

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
 * Bearer tokens that don't start with `rex_` are ignored here — they're
 * treated as JWTs by the dashboard auth middleware (verifyToken). That
 * lets the same Authorization header serve both flows on different routes.
 *
 * Invalid or revoked API keys (X-API-Key header or rex_ Bearer that fails
 * verification) hard-fail with 401 — we never silently downgrade to anon,
 * otherwise typos in client config would look like quota issues.
 */
function apiKeyAuth(req, res, next) {
  const supplied = extractKey(req);
  if (!supplied) {
    req.apiKey = null;
    return next();
  }

  if (!supplied.startsWith(KEY_PREFIX)) {
    return ResponseHandler.error(res, 'Invalid API key format', 401);
  }

  const verified = verifyKey(supplied);
  if (!verified) {
    return ResponseHandler.error(res, 'Invalid or revoked API key', 401);
  }

  req.apiKey = verified;
  try {
    touchKey(verified.id);
  } catch {
    /* lastUsedAt update is best-effort */
  }
  return next();
}

function requireMaster(req, res, next) {
  if (req.apiKey?.tier !== 'master') {
    return ResponseHandler.error(res, 'Master API key required', 403);
  }
  return next();
}

module.exports = { apiKeyAuth, requireMaster, extractKey };
