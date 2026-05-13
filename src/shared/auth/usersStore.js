const crypto = require('crypto');
const logger = require('../utils/logger');
const supabase = require('./supabaseClient');

const TABLE = 'rex_users';

/**
 * In-memory cache. Loaded once on init() and kept hot so all read APIs
 * remain synchronous (apiKeyAuth + many controllers depend on this).
 * Mutations write through to Supabase fire-and-forget; persistNow() is
 * available for callers that need the round-trip to complete (e.g.
 * registration, regenerate-key) before responding to the client.
 */
let cache = null; // { users: User[] }
const indexes = {
  byEmail: new Map(),
  byUsername: new Map(),
  byApiKeyId: new Map(),
  byId: new Map(),
};

const pendingWrites = new Set(); // Promises tracked by persistNow()

function trackWrite(promise) {
  pendingWrites.add(promise);
  promise
    .catch((err) => logger.error(`[users] Supabase write failed: ${err.message}`))
    .finally(() => pendingWrites.delete(promise));
  return promise;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    apiKeyId: row.api_key_id,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function userToRow(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    password_hash: user.passwordHash,
    api_key_id: user.apiKeyId,
    created_at: user.createdAt,
    last_login_at: user.lastLoginAt,
  };
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

async function init() {
  supabase.assertEnabled();
  const { data, error } = await supabase
    .getClient()
    .from(TABLE)
    .select('*');
  if (error) throw new Error(`[users] init failed: ${error.message}`);
  cache = { users: (data || []).map(rowToUser) };
  rebuildIndexes();
  logger.info(`[users] Supabase store ready (${cache.users.length} users)`);
}

function ensureLoaded() {
  if (!cache) {
    throw new Error('[users] Store not initialised — call init() at startup.');
  }
}

function publicView(user) {
  if (!user) return null;
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

function findById(id) {
  ensureLoaded();
  return indexes.byId.get(id) || null;
}

function findByEmail(email) {
  ensureLoaded();
  if (typeof email !== 'string') return null;
  return indexes.byEmail.get(email.toLowerCase()) || null;
}

function findByUsername(username) {
  ensureLoaded();
  if (typeof username !== 'string') return null;
  return indexes.byUsername.get(username.toLowerCase()) || null;
}

function findByEmailOrUsername(value) {
  return findByEmail(value) || findByUsername(value);
}

function findByApiKeyId(apiKeyId) {
  ensureLoaded();
  return indexes.byApiKeyId.get(apiKeyId) || null;
}

function listUsers() {
  ensureLoaded();
  return cache.users.map(publicView);
}

function createUser({ username, email, passwordHash, apiKeyId }) {
  ensureLoaded();
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
  trackWrite(supabase.getClient().from(TABLE).insert(userToRow(user)).then(({ error }) => {
    if (error) throw new Error(error.message);
  }));
  return publicView(user);
}

function touchLogin(userId) {
  const user = findById(userId);
  if (!user) return null;
  user.lastLoginAt = new Date().toISOString();
  trackWrite(
    supabase.getClient().from(TABLE).update({ last_login_at: user.lastLoginAt }).eq('id', userId)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  );
  return publicView(user);
}

function updateApiKeyId(userId, newApiKeyId) {
  const user = findById(userId);
  if (!user) return null;
  user.apiKeyId = newApiKeyId;
  rebuildIndexes();
  trackWrite(
    supabase.getClient().from(TABLE).update({ api_key_id: newApiKeyId }).eq('id', userId)
      .then(({ error }) => { if (error) throw new Error(error.message); })
  );
  return publicView(user);
}

/**
 * Wait for any in-flight writes to finish. Call from request handlers that
 * must guarantee durability before responding (register, regenerate-key).
 */
async function persistNow() {
  if (pendingWrites.size === 0) return;
  await Promise.allSettled([...pendingWrites]);
}

function _resetForTests() {
  cache = null;
  indexes.byEmail.clear();
  indexes.byUsername.clear();
  indexes.byApiKeyId.clear();
  indexes.byId.clear();
  pendingWrites.clear();
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
};
