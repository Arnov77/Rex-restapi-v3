const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const STORE_DIR = path.join(__dirname, '../../../data');
const SECRET_FILE = path.join(STORE_DIR, 'jwt-secret.txt');

let cachedSecret = null;
let cachedExpiresIn = null;

/**
 * Resolve the JWT signing secret with the same dual-mode bootstrap as
 * MASTER_API_KEY:
 *   - JWT_SECRET env wins when set
 *   - otherwise generate a 64-byte hex secret, write it to data/jwt-secret.txt
 *     (chmod 0600), log a warning so the operator moves it into env on
 *     subsequent boots
 */
function ensureSecret() {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret.length >= 32) {
    cachedSecret = envSecret;
    return cachedSecret;
  }

  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (stored && stored.length >= 32) {
      cachedSecret = stored;
      logger.warn(
        `[jwt] JWT_SECRET env not set; reusing ${SECRET_FILE}. Move it into env to silence this warning.`
      );
      return cachedSecret;
    }
  }

  const generated = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(SECRET_FILE, `${generated}\n`, { mode: 0o600 });
  cachedSecret = generated;
  logger.warn('[jwt] No JWT_SECRET env. Generated bootstrap secret:');
  logger.warn(`[jwt]   ${SECRET_FILE} (chmod 0600)`);
  logger.warn('[jwt] Move it into JWT_SECRET env on the next deploy.');
  return cachedSecret;
}

function expiresIn() {
  if (cachedExpiresIn) return cachedExpiresIn;
  cachedExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return cachedExpiresIn;
}

function sign(payload) {
  return jwt.sign(payload, ensureSecret(), { algorithm: 'HS256', expiresIn: expiresIn() });
}

function verify(token) {
  return jwt.verify(token, ensureSecret(), { algorithms: ['HS256'] });
}

function _resetForTests() {
  cachedSecret = null;
  cachedExpiresIn = null;
}

module.exports = {
  sign,
  verify,
  ensureSecret,
  expiresIn,
  _resetForTests,
  _SECRET_FILE: SECRET_FILE,
};
