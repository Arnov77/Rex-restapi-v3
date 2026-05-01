const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const supabase = require('./supabasePersistence');

const STORE_DIR = path.join(__dirname, '../../../data');
const STORE_PATH = path.join(STORE_DIR, 'api-keys.json');
const KEY_PREFIX = 'rex_';
const VALID_TIERS = new Set(['user', 'master']);

let cache = null;
const lastUsedDirty = new Set();
let lastUsedFlushAt = 0;
const LAST_USED_FLUSH_MS = 60_000;

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return { keys: [] };
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.keys)) return { keys: [] };
    return parsed;
  } catch (err) {
    logger.error(`[apikeys] Store at ${STORE_PATH} is corrupt: ${err.message}`);
    throw err;
  }
}

function writeStore(data) {
  ensureDir();
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function hashKey(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf-8').digest('hex');
}

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function load() {
  if (!cache) cache = readStore();
  return cache;
}

function persist() {
  if (cache) writeStore(cache);
  if (cache) {
    supabase.persistRows(
      supabase.TABLES.apiKeys,
      cache.keys.map((key) => ({ id: key.id, data: key, updated_at: new Date().toISOString() })),
      'api keys'
    );
  }
}

async function init() {
  if (!supabase.isEnabled()) {
    load();
    return;
  }

  const rows = await supabase.loadRows(supabase.TABLES.apiKeys);
  if (rows.length) {
    cache = { keys: rows.map((row) => row.data).filter(Boolean) };
  } else {
    cache = readStore();
    if (cache.keys.length) persist();
  }
  logger.info(`[apikeys] Supabase store ready (${cache.keys.length} keys)`);
}

function listKeys() {
  return load().keys.map(({ keyHash: _h, key: _k, ...rest }) => rest);
}

/**
 * Return the plaintext API key value for a record. Used by the user-facing
 * profile endpoint so members can re-display & copy their key without
 * needing admin help. Master / admin-created keys (Phase 1, hash-only) have
 * no `key` field stored — returns null in that case.
 */
function getPlaintextById(id) {
  const record = findById(id);
  return record && typeof record.key === 'string' ? record.key : null;
}

function findByHash(hash) {
  return load().keys.find((k) => k.keyHash === hash) || null;
}

function findById(id) {
  return load().keys.find((k) => k.id === id) || null;
}

/**
 * Verify a plaintext API key. Returns the public record (no hash) when the
 * key matches and is not revoked, otherwise null.
 */
function verifyKey(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.startsWith(KEY_PREFIX)) return null;
  const record = findByHash(hashKey(plaintext));
  if (!record || record.revoked) return null;
  return { id: record.id, name: record.name, tier: record.tier };
}

function createKey({ name, tier = 'user', dailyLimit = null }) {
  if (!VALID_TIERS.has(tier)) {
    throw new Error(`Invalid tier "${tier}". Must be one of: ${[...VALID_TIERS].join(', ')}`);
  }
  const plaintext = generateKey();
  const record = {
    id: crypto.randomUUID(),
    name: String(name || '').slice(0, 80) || 'unnamed',
    tier,
    keyHash: hashKey(plaintext),
    // Plaintext stored alongside the hash so /api/user/profile can re-display
    // it (member self-service: 'click to show', 'click to copy'). Hash is
    // still the source of truth for verification — see verifyKey().
    key: plaintext,
    dailyLimit: dailyLimit == null ? null : Math.max(0, Math.floor(dailyLimit)),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
  };
  load().keys.push(record);
  persist();
  return { plaintext, record: { ...record, keyHash: undefined, key: undefined } };
}

function updateKey(id, patch = {}) {
  const record = findById(id);
  if (!record) return null;
  if (patch.name != null) record.name = String(patch.name).slice(0, 80) || record.name;
  if (patch.dailyLimit !== undefined) {
    record.dailyLimit = patch.dailyLimit == null ? null : Math.max(0, Math.floor(patch.dailyLimit));
  }
  if (patch.tier != null) {
    if (!VALID_TIERS.has(patch.tier)) {
      throw new Error(`Invalid tier "${patch.tier}"`);
    }
    record.tier = patch.tier;
  }
  record.updatedAt = new Date().toISOString();
  persist();
  return { ...record, keyHash: undefined, key: undefined };
}

function revokeKey(id) {
  const record = findById(id);
  if (!record) return null;
  if (!record.revoked) {
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    persist();
  }
  return { ...record, keyHash: undefined, key: undefined };
}

/**
 * Mark a key as recently used. Buffered in memory and flushed at most every
 * LAST_USED_FLUSH_MS to avoid disk thrash on hot endpoints.
 */
function touchKey(id) {
  const record = findById(id);
  if (!record) return;
  record.lastUsedAt = new Date().toISOString();
  lastUsedDirty.add(id);
  if (Date.now() - lastUsedFlushAt >= LAST_USED_FLUSH_MS) {
    persist();
    lastUsedDirty.clear();
    lastUsedFlushAt = Date.now();
  }
}

function flushPendingTouches() {
  if (lastUsedDirty.size > 0) {
    persist();
    lastUsedDirty.clear();
    lastUsedFlushAt = Date.now();
  }
}

/**
 * Ensure a master key exists. Honours `MASTER_API_KEY` env var when set
 * (operator-controlled secret); otherwise generates one, persists its hash,
 * and writes the plaintext to data/master-key.txt for first-run pickup.
 */
function ensureMasterKey() {
  const store = load();
  const hasMaster = store.keys.some((k) => k.tier === 'master' && !k.revoked);
  const envKey = process.env.MASTER_API_KEY;

  if (envKey && envKey.startsWith(KEY_PREFIX)) {
    const envHash = hashKey(envKey);
    const matching = store.keys.find((k) => k.keyHash === envHash);
    if (matching) {
      if (matching.tier !== 'master') matching.tier = 'master';
      if (matching.revoked) matching.revoked = false;
      persist();
      logger.info('[apikeys] MASTER_API_KEY env matched existing record');
      return;
    }
    store.keys.push({
      id: crypto.randomUUID(),
      name: 'master (from env)',
      tier: 'master',
      keyHash: envHash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revoked: false,
    });
    persist();
    logger.info('[apikeys] MASTER_API_KEY env registered as master key');
    return;
  }

  if (hasMaster) return;

  const { plaintext } = createKey({ name: 'master (auto-generated)', tier: 'master' });
  const noticePath = path.join(STORE_DIR, 'master-key.txt');
  fs.writeFileSync(noticePath, `${plaintext}\n`, { mode: 0o600 });
  logger.warn('[apikeys] No master key found. Generated bootstrap MASTER key:');
  logger.warn(`[apikeys]   ${plaintext}`);
  logger.warn(
    `[apikeys] Saved to ${noticePath}. Move it to MASTER_API_KEY env, then delete the file.`
  );
}

function _resetForTests() {
  cache = null;
  lastUsedDirty.clear();
  lastUsedFlushAt = 0;
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
  _resetForTests,
  _STORE_PATH: STORE_PATH,
};
