/**
 * users repository — pure DB access, no in-memory cache.
 *
 * Every read/write is async and goes straight to Supabase. Multi-instance
 * safe; trade-off is one round-trip per call (fine at current scale).
 */
const crypto = require('crypto');
const supabase = require('../auth/supabaseClient');

const TABLE = 'rex_users';

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

function publicView(user) {
  if (!user) return null;
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

async function findById(id) {
  if (!id) return null;
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`[users.repo] findById: ${error.message}`);
  return rowToUser(data);
}

async function findByEmail(email) {
  if (typeof email !== 'string') return null;
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('email', email.toLowerCase()).maybeSingle();
  if (error) throw new Error(`[users.repo] findByEmail: ${error.message}`);
  return rowToUser(data);
}

async function findByUsername(username) {
  if (typeof username !== 'string') return null;
  // Username comparison is case-insensitive (matches old store behaviour).
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').ilike('username', username).maybeSingle();
  if (error) throw new Error(`[users.repo] findByUsername: ${error.message}`);
  return rowToUser(data);
}

async function findByEmailOrUsername(value) {
  return (await findByEmail(value)) || (await findByUsername(value));
}

async function findByApiKeyId(apiKeyId) {
  if (!apiKeyId) return null;
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('api_key_id', apiKeyId).maybeSingle();
  if (error) throw new Error(`[users.repo] findByApiKeyId: ${error.message}`);
  return rowToUser(data);
}

async function listUsers() {
  const { data, error } = await supabase.getClient().from(TABLE).select('*');
  if (error) throw new Error(`[users.repo] listUsers: ${error.message}`);
  return (data || []).map(rowToUser).map(publicView);
}

async function insertUser({ username, email, passwordHash, apiKeyId }) {
  const row = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    email: String(email).trim().toLowerCase(),
    password_hash: passwordHash,
    api_key_id: apiKeyId,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  const { data, error } = await supabase.getClient()
    .from(TABLE).insert(row).select('*').single();
  if (error) {
    // 23505 = unique_violation — surface a structured code so service layer
    // can translate to ConflictError without relying on string matching.
    if (error.code === '23505') {
      const e = new Error('Duplicate user');
      e.code = error.message.includes('email') ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN';
      throw e;
    }
    throw new Error(`[users.repo] insertUser: ${error.message}`);
  }
  return rowToUser(data);
}

async function touchLogin(userId) {
  const at = new Date().toISOString();
  const { error } = await supabase.getClient()
    .from(TABLE).update({ last_login_at: at }).eq('id', userId);
  if (error) throw new Error(`[users.repo] touchLogin: ${error.message}`);
  return at;
}

async function updateApiKeyId(userId, newApiKeyId) {
  const { error } = await supabase.getClient()
    .from(TABLE).update({ api_key_id: newApiKeyId }).eq('id', userId);
  if (error) throw new Error(`[users.repo] updateApiKeyId: ${error.message}`);
}

module.exports = {
  publicView,
  findById,
  findByEmail,
  findByUsername,
  findByEmailOrUsername,
  findByApiKeyId,
  listUsers,
  insertUser,
  touchLogin,
  updateApiKeyId,
};
