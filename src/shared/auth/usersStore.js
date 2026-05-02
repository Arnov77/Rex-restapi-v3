const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const supabase = require('./supabasePersistence');

const STORE_DIR = path.join(__dirname, '../../../data');
const STORE_PATH = path.join(STORE_DIR, 'users.json');

let cache = null;
const indexes = {
  byEmail: new Map(),
  byUsername: new Map(),
  byApiKeyId: new Map(),
  byId: new Map(),
};

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

function readStore() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return { users: [] };
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch (err) {
    logger.error(`[users] Store at ${STORE_PATH} is corrupt: ${err.message}`);
    throw err;
  }
}

function writeStore(data) {
  ensureDir();
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function rebuildIndexes() {
  indexes.byEmail.clear();
  indexes.byUsername.clear();
  indexes.byApiKeyId.clear();
  indexes.byId.clear();
  for (const u of cache.users) {
    indexes.byId.set(u.id, u);
    if (u.email) indexes.byEmail.set(u.email.toLowerCase(), u);
    if (u.username) indexes.byUsername.set(u.username.toLowerCase(), u);
    if (u.apiKeyId) indexes.byApiKeyId.set(u.apiKeyId, u);
  }
}

function load() {
  if (!cache) {
    cache = readStore();
    rebuildIndexes();
  }
  return cache;
}

function persist({ wait = false } = {}) {
  if (!cache) return wait ? Promise.resolve() : undefined;
  if (supabase.isEnabled()) {
    const rows = cache.users.map((user) => ({
      id: user.id,
      data: user,
      updated_at: new Date().toISOString(),
    }));
    if (wait) return supabase.persistRowsAsync(supabase.TABLES.users, rows);
    supabase.persistRows(supabase.TABLES.users, rows, 'users');
    return undefined;
  }
  writeStore(cache);
  return wait ? Promise.resolve() : undefined;
}

function persistNow() {
  return persist({ wait: true });
}

async function init() {
  if (!supabase.isEnabled()) {
    load();
    return;
  }

  const rows = await supabase.loadRows(supabase.TABLES.users);
  if (rows.length) {
    cache = { users: rows.map((row) => row.data).filter(Boolean) };
  } else {
    cache = readStore();
    if (cache.users.length) persist();
  }
  rebuildIndexes();
  logger.info(`[users] Supabase store ready (${cache.users.length} users)`);
}

function publicView(user) {
  if (!user) return null;
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

function findById(id) {
  load();
  return indexes.byId.get(id) || null;
}

function findByEmail(email) {
  load();
  if (typeof email !== 'string') return null;
  return indexes.byEmail.get(email.toLowerCase()) || null;
}

function findByUsername(username) {
  load();
  if (typeof username !== 'string') return null;
  return indexes.byUsername.get(username.toLowerCase()) || null;
}

function findByEmailOrUsername(value) {
  return findByEmail(value) || findByUsername(value);
}

function findByApiKeyId(apiKeyId) {
  load();
  return indexes.byApiKeyId.get(apiKeyId) || null;
}

function listUsers() {
  return load().users.map(publicView);
}

/**
 * Create a new user. Caller is responsible for hashing the password
 * and creating the API key (so we don't pull bcrypt / apiKeyStore as
 * a dependency here — keeps the store layer pure).
 */
function createUser({ username, email, passwordHash, apiKeyId }) {
  load();
  if (findByEmail(email)) {
    const err = new Error('Email already registered');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  if (findByUsername(username)) {
    const err = new Error('Username already taken');
    err.code = 'USERNAME_TAKEN';
    throw err;
  }
  const user = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    email: String(email).trim().toLowerCase(),
    passwordHash,
    apiKeyId,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  cache.users.push(user);
  rebuildIndexes();
  persist();
  return publicView(user);
}

function touchLogin(userId) {
  const user = findById(userId);
  if (!user) return null;
  user.lastLoginAt = new Date().toISOString();
  persist();
  return publicView(user);
}

function updateApiKeyId(userId, newApiKeyId) {
  const user = findById(userId);
  if (!user) return null;
  user.apiKeyId = newApiKeyId;
  rebuildIndexes();
  persist();
  return publicView(user);
}

function _resetForTests() {
  cache = null;
  indexes.byEmail.clear();
  indexes.byUsername.clear();
  indexes.byApiKeyId.clear();
  indexes.byId.clear();
}

module.exports = {
  createUser,
  findById,
  findByEmail,
  findByUsername,
  findByEmailOrUsername,
  findByApiKeyId,
  listUsers,
  touchLogin,
  updateApiKeyId,
  publicView,
  init,
  persistNow,
  _resetForTests,
  _STORE_PATH: STORE_PATH,
};
