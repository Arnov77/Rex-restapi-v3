/**
 * apiKeys service — business logic on top of apiKeys.repo.
 *
 * Owns crypto (key generation, hashing, AES-GCM encryption of the plaintext
 * for later reveal) and lifecycle helpers (createForUser, rotateForUser,
 * revoke, ensureMaster, verifyPlaintext).
 */
const crypto = require('crypto');
const logger = require('../../shared/utils/logger');
const apiKeysRepo = require('../../shared/repositories/apiKeys.repo');

const KEY_PREFIX = 'rex_';
const VALID_TIERS = new Set(['user', 'master']);
const KEY_ENCRYPTION_VERSION = 1;

// ── Crypto ───────────────────────────────────────────────────────────────────
function hashKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf-8').digest('hex');
}

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function encryptionSecret() {
  return process.env.API_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || '';
}

function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret, 'utf-8').digest();
}

function encryptPlaintext(plaintext) {
  const key = encryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${KEY_ENCRYPTION_VERSION}`,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptPlaintext(record) {
  if (!record || typeof record.keyEncrypted !== 'string') return null;
  const key = encryptionKey();
  if (!key) return null;
  const [version, ivRaw, tagRaw, ciphertextRaw] = record.keyEncrypted.split('.');
  if (version !== `v${KEY_ENCRYPTION_VERSION}` || !ivRaw || !tagRaw || !ciphertextRaw) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf-8');
  } catch {
    return null;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function createKey({ name, tier = 'user', dailyLimit = null }) {
  if (!VALID_TIERS.has(tier)) {
    throw new Error(`Invalid tier "${tier}". Must be one of: ${[...VALID_TIERS].join(', ')}`);
  }
  const plaintext = generateKey();
  const record = {
    id: crypto.randomUUID(),
    name: String(name || '').slice(0, 80) || 'unnamed',
    tier,
    keyHash: hashKey(plaintext),
    keyEncrypted: encryptPlaintext(plaintext),
    dailyLimit: dailyLimit == null ? null : Math.max(0, Math.floor(dailyLimit)),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    lastUsedAt: null,
    revoked: false,
    revokedAt: null,
  };
  const inserted = await apiKeysRepo.insert(record);
  return { plaintext, record: apiKeysRepo.publicView(inserted) };
}

async function updateKey(id, patch = {}) {
  const update = {};
  if (patch.name != null) update.name = String(patch.name).slice(0, 80) || undefined;
  if (patch.dailyLimit !== undefined) {
    update.daily_limit = patch.dailyLimit == null ? null : Math.max(0, Math.floor(patch.dailyLimit));
  }
  if (patch.tier != null) {
    if (!VALID_TIERS.has(patch.tier)) throw new Error(`Invalid tier "${patch.tier}"`);
    update.tier = patch.tier;
  }
  const result = await apiKeysRepo.update(id, update);
  return apiKeysRepo.publicView(result);
}

async function revokeKey(id) {
  const existing = await apiKeysRepo.findById(id);
  if (!existing) return null;
  if (existing.revoked) return apiKeysRepo.publicView(existing);
  return apiKeysRepo.publicView(await apiKeysRepo.revoke(id));
}

async function getPlaintextById(id) {
  const record = await apiKeysRepo.findById(id);
  return decryptPlaintext(record);
}

async function verifyPlaintextKey(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.startsWith(KEY_PREFIX)) return null;
  const record = await apiKeysRepo.findByHash(hashKey(plaintext));
  if (!record || record.revoked) return null;
  return { id: record.id, name: record.name, tier: record.tier };
}

/**
 * Best-effort: update last_used_at. Errors are swallowed (caller is the auth
 * middleware on the hot path — a touch failure must never block the request).
 */
function touchKey(id) {
  apiKeysRepo.touch(id).catch((err) =>
    logger.warn(`[apiKeys.service] touch failed for ${id}: ${err.message}`)
  );
}

/**
 * Ensure a master key exists. Honours `MASTER_API_KEY` env var when set;
 * otherwise generates one and logs the plaintext (operator must capture it
 * from logs and move it to MASTER_API_KEY env on the next deploy).
 */
async function ensureMasterKey() {
  const envKey = process.env.MASTER_API_KEY;

  if (envKey && envKey.startsWith(KEY_PREFIX)) {
    const envHash = hashKey(envKey);
    const matching = await apiKeysRepo.findByHash(envHash);
    if (matching) {
      const patch = {};
      if (matching.tier !== 'master') patch.tier = 'master';
      if (matching.revoked) {
        patch.revoked = false;
        patch.revoked_at = null;
      }
      if (Object.keys(patch).length > 0) {
        await apiKeysRepo.update(matching.id, patch);
      }
      logger.info('[apiKeys] MASTER_API_KEY env matched existing record');
      return;
    }
    await apiKeysRepo.insert({
      id: crypto.randomUUID(),
      name: 'master (from env)',
      tier: 'master',
      keyHash: envHash,
      keyEncrypted: null, // env-supplied key — operator already has plaintext
      dailyLimit: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      lastUsedAt: null,
      revoked: false,
      revokedAt: null,
    });
    logger.info('[apiKeys] MASTER_API_KEY env registered as master key');
    return;
  }

  const masters = await apiKeysRepo.listMasters();
  if (masters.length > 0) return;

  const { plaintext } = await createKey({ name: 'master (auto-generated)', tier: 'master' });
  logger.warn('[apiKeys] No master key found. Generated bootstrap MASTER key:');
  logger.warn(`[apiKeys]   ${plaintext}`);
  logger.warn('[apiKeys] Capture this value, set it as MASTER_API_KEY env, and restart.');
}

module.exports = {
  KEY_PREFIX,
  hashKey,
  createKey,
  updateKey,
  revokeKey,
  getPlaintextById,
  verifyPlaintextKey,
  touchKey,
  ensureMasterKey,
};
