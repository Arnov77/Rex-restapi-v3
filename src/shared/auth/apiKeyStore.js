const crypto = require('crypto');
const logger = require('../utils/logger');
const supabase = require('./supabaseClient');

const TABLE = 'rex_api_keys';
const KEY_PREFIX = 'rex_';
const VALID_TIERS = new Set(['user', 'master']);
const KEY_ENCRYPTION_VERSION = 1;
const LAST_USED_FLUSH_MS = 60_000;

let cache = null; // { keys: ApiKey[] }
const lastUsedDirty = new Set();
let lastUsedFlushAt = 0;

const pendingWrites = new Set();
function trackWrite(promise) {
  pendingWrites.add(promise);
  promise
    .catch((err) => logger.error(`[apikeys] Supabase write failed: ${err.message}`))
    .finally(() => pendingWrites.delete(promise));
  return promise;
}

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
  if (!key) return { keyEncrypted: null, keyPlaintextFallback: plaintext };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyEncrypted: [
      `v${KEY_ENCRYPTION_VERSION}`,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.'),
    keyPlaintextFallback: null,
  };
}

function decryptPlaintext(record) {
  if (!record) return null;
  if (record.keyPlaintextFallback) return record.keyPlaintextFallback;
  if (typeof record.keyEncrypted !== 'string') return null;
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

// ── Row mapping ──────────────────────────────────────────────────────────────
function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    keyHash: row.key_hash,
    keyEncrypted: row.key_encrypted,
    keyPlaintextFallback: null,
    dailyLimit: row.daily_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revoked: row.revoked,
    revokedAt: row.revoked_at,
  };
}

function keyToRow(k) {
  return {
    id: k.id,
    name: k.name,
    tier: k.tier,
    key_hash: k.keyHash,
    key_encrypted: k.keyEncrypted,
    daily_limit: k.dailyLimit,
    created_at: k.createdAt,
    updated_at: k.updatedAt,
    last_used_at: k.lastUsedAt,
    revoked: k.revoked,
    revoked_at: k.revokedAt,
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function init() {
  supabase.assertEnabled();
  const { data, error } = await supabase.getClient().from(TABLE).select('*');
  if (error) throw new Error(`[apikeys] init failed: ${error.message}`);
  cache = { keys: (data || []).map(rowToKey) };
  logger.info(`[apikeys] Supabase store ready (${cache.keys.length} keys)`);
}

function ensureLoaded() {
  if (!cache) throw new Error('[apikeys] Store not initialised — call init() at startup.');
}

// ── Read API ─────────────────────────────────────────────────────────────────
function publicView(record) {
  if (!record) return null;
  const { keyHash: _h, keyEncrypted: _e, keyPlaintextFallback: _p, ...rest } = record;
  return rest;
}

function listKeys() {
  ensureLoaded();
  return cache.keys.map(publicView);
}

function findById(id) {
  ensureLoaded();
  return cache.keys.find((k) => k.id === id) || null;
}

function findByHash(hash) {
  ensureLoaded();
  return cache.keys.find((k) => k.keyHash === hash) || null;
}

function getPlaintextById(id) {
  return decryptPlaintext(findById(id));
}

function verifyKey(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.startsWith(KEY_PREFIX)) return null;
  const record = findByHash(hashKey(plaintext));
  if (!record || record.revoked) return null;
  return { id: record.id, name: record.name, tier: record.tier };
}

// ── Mutations ────────────────────────────────────────────────────────────────
function createKey({ name, tier = 'user', dailyLimit = null }) {
  ensureLoaded();
  if (!VALID_TIERS.has(tier)) {
    throw new Error(`Invalid tier "${tier}". Must be one of: ${[...VALID_TIERS].join(', ')}`);
  }
  const plaintext = generateKey();
  const enc = encryptPlaintext(plaintext);
  const record = {
    id: crypto.randomUUID(),
    name: String(name || '').slice(0, 80) || 'unnamed',
    tier,
    keyHash: hashKey(plaintext),
    keyEncrypted: enc.keyEncrypted,
    keyPlaintextFallback: enc.keyPlaintextFallback,
    dailyLimit: dailyLimit == null ? null : Math.max(0, Math.floor(dailyLimit)),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    lastUsedAt: null,
    revoked: false,
    revokedAt: null,
  };
  cache.keys.push(record);
  trackWrite(
    supabase.getClient().from(TABLE).insert(keyToRow(record))
      .then(({ error }) => { if (error) throw new Error(error.message); })
  );
  return { plaintext, record: publicView(record) };
}

function updateKey(id, patch = {}) {
  const record = findById(id);
  if (!record) return null;
  const update = {};
  if (patch.name != null) {
    record.name = String(patch.name).slice(0, 80) || record.name;
    update.name = record.name;
  }
  if (patch.dailyLimit !== undefined) {
    record.dailyLimit = patch.dailyLimit == null ? null : Math.max(0, Math.floor(patch.dailyLimit));
    update.daily_limit = record.dailyLimit;
  }
  if (patch.tier != null) {
    if (!VALID_TIERS.has(patch.tier)) throw new Error(`Invalid tier "${patch.tier}"`);
    record.tier = patch.tier;
    update.tier = patch.tier;
  }
  record.updatedAt = new Date().toISOString();
  update.updated_at = record.updatedAt;
  trackWrite(
    supabase.getClient().from(TABLE).update(update).eq('id', id)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  );
  return publicView(record);
}

function revokeKey(id) {
  const record = findById(id);
  if (!record) return null;
  if (!record.revoked) {
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    trackWrite(
      supabase.getClient().from(TABLE)
        .update({ revoked: true, revoked_at: record.revokedAt }).eq('id', id)
        .then(({ error }) => { if (error) throw new Error(error.message); })
    );
  }
  return publicView(record);
}

/**
 * Mark a key as recently used. Buffered in memory and flushed at most every
 * LAST_USED_FLUSH_MS to avoid hammering Supabase on hot endpoints.
 */
function touchKey(id) {
  const record = findById(id);
  if (!record) return;
  record.lastUsedAt = new Date().toISOString();
  lastUsedDirty.add(id);
  if (Date.now() - lastUsedFlushAt >= LAST_USED_FLUSH_MS) {
    flushPendingTouches();
  }
}

function flushPendingTouches() {
  if (lastUsedDirty.size === 0) return;
  const ids = [...lastUsedDirty];
  lastUsedDirty.clear();
  lastUsedFlushAt = Date.now();
  // Send one update per id (Supabase REST has no native multi-row UPDATE
  // with different values). Volume is tiny — bounded by active key count.
  for (const id of ids) {
    const rec = findById(id);
    if (!rec) continue;
    trackWrite(
      supabase.getClient().from(TABLE)
        .update({ last_used_at: rec.lastUsedAt }).eq('id', id)
        .then(({ error }) => { if (error) throw new Error(error.message); })
    );
  }
}

async function persistNow() {
  flushPendingTouches();
  if (pendingWrites.size === 0) return;
  await Promise.allSettled([...pendingWrites]);
}

/**
 * Ensure a master key exists. Honours `MASTER_API_KEY` env var when set;
 * otherwise generates one and logs the plaintext to stdout (operator must
 * capture it from logs and move to MASTER_API_KEY env on next deploy).
 */
function ensureMasterKey() {
  ensureLoaded();
  const hasMaster = cache.keys.some((k) => k.tier === 'master' && !k.revoked);
  const envKey = process.env.MASTER_API_KEY;

  if (envKey && envKey.startsWith(KEY_PREFIX)) {
    const envHash = hashKey(envKey);
    const matching = cache.keys.find((k) => k.keyHash === envHash);
    if (matching) {
      const update = {};
      if (matching.tier !== 'master') { matching.tier = 'master'; update.tier = 'master'; }
      if (matching.revoked) { matching.revoked = false; update.revoked = false; update.revoked_at = null; matching.revokedAt = null; }
      if (Object.keys(update).length > 0) {
        trackWrite(
          supabase.getClient().from(TABLE).update(update).eq('id', matching.id)
            .then(({ error }) => { if (error) throw new Error(error.message); })
        );
      }
      logger.info('[apikeys] MASTER_API_KEY env matched existing record');
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      name: 'master (from env)',
      tier: 'master',
      keyHash: envHash,
      keyEncrypted: null,
      keyPlaintextFallback: null,
      dailyLimit: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      lastUsedAt: null,
      revoked: false,
      revokedAt: null,
    };
    cache.keys.push(record);
    trackWrite(
      supabase.getClient().from(TABLE).insert(keyToRow(record))
        .then(({ error }) => { if (error) throw new Error(error.message); })
    );
    logger.info('[apikeys] MASTER_API_KEY env registered as master key');
    return;
  }

  if (hasMaster) return;

  const { plaintext } = createKey({ name: 'master (auto-generated)', tier: 'master' });
  logger.warn('[apikeys] No master key found. Generated bootstrap MASTER key:');
  logger.warn(`[apikeys]   ${plaintext}`);
  logger.warn('[apikeys] Capture this value, set it as MASTER_API_KEY env, and restart.');
}

function _resetForTests() {
  cache = null;
  lastUsedDirty.clear();
  lastUsedFlushAt = 0;
  pendingWrites.clear();
}

module.exports = {
  KEY_PREFIX,
  hashKey,
  verifyKey,
  createKey,
  updateKey,
  revokeKey,
  touchKey,
  findById,
  listKeys,
  getPlaintextById,
  ensureMasterKey,
  flushPendingTouches,
  init,
  persistNow,
  _resetForTests,
};
