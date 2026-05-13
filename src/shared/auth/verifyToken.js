const { verify } = require('./jwt');
const usersRepo = require('../repositories/users.repo');
const ResponseHandler = require('../utils/response');
const { KEY_PREFIX } = require('../../core/auth/apiKeys.service');

/**
 * Pull a JWT from `Authorization: Bearer <jwt>`. Skips values that look
 * like API keys (rex_ prefix) — those are handled by apiKeyAuth.
 */
function extractToken(req) {
  const auth = req.get('authorization');
  if (typeof auth !== 'string') return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  if (!token || token.startsWith(KEY_PREFIX)) return null;
  return token;
}

/**
 * Hard-require a valid JWT. Sets `req.user` to the public user record on
 * success. Used to gate dashboard routes (/api/user/*).
 */
async function verifyToken(req, res, next) {
  const token = extractToken(req);
  if (!token) return ResponseHandler.error(res, 'Missing bearer token', 401);

  let payload;
  try {
    payload = verify(token);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return ResponseHandler.error(res, msg, 401);
  }

  const user = await usersRepo.findById(payload.sub);
  if (!user) return ResponseHandler.error(res, 'User no longer exists', 401);

  req.user = usersRepo.publicView(user);
  return next();
}

module.exports = { verifyToken, extractToken };
