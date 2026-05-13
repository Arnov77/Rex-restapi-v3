/**
 * apiKeys repository — pure DB access. Crypto/business helpers live in
 * apiKeys.service.js so this file only knows the table shape.
 */
const supabase = require('../auth/supabaseClient');

const TABLE = 'rex_api_keys';

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    keyHash: row.key_hash,
    keyEncrypted: row.key_encrypted,
    dailyLimit: row.daily_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revoked: row.revoked,
    revokedAt: row.revoked_at,
  };
}

function publicView(record) {
  if (!record) return null;
  const { keyHash: _h, keyEncrypted: _e, ...rest } = record;
  return rest;
}

async function findById(id) {
  if (!id) return null;
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`[apiKeys.repo] findById: ${error.message}`);
  return rowToKey(data);
}

async function findByHash(hash) {
  if (!hash) return null;
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('key_hash', hash).maybeSingle();
  if (error) throw new Error(`[apiKeys.repo] findByHash: ${error.message}`);
  return rowToKey(data);
}

async function listKeys() {
  const { data, error } = await supabase.getClient().from(TABLE).select('*');
  if (error) throw new Error(`[apiKeys.repo] listKeys: ${error.message}`);
  return (data || []).map(rowToKey);
}

async function listMasters() {
  const { data, error } = await supabase.getClient()
    .from(TABLE).select('*').eq('tier', 'master').eq('revoked', false);
  if (error) throw new Error(`[apiKeys.repo] listMasters: ${error.message}`);
  return (data || []).map(rowToKey);
}

async function insert(record) {
  const row = {
    id: record.id,
    name: record.name,
    tier: record.tier,
    key_hash: record.keyHash,
    key_encrypted: record.keyEncrypted,
    daily_limit: record.dailyLimit,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_used_at: record.lastUsedAt,
    revoked: record.revoked,
    revoked_at: record.revokedAt,
  };
  const { data, error } = await supabase.getClient()
    .from(TABLE).insert(row).select('*').single();
  if (error) throw new Error(`[apiKeys.repo] insert: ${error.message}`);
  return rowToKey(data);
}

async function update(id, patch) {
  if (Object.keys(patch).length === 0) return findById(id);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.getClient()
    .from(TABLE).update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(`[apiKeys.repo] update: ${error.message}`);
  return rowToKey(data);
}

async function revoke(id) {
  const { data, error } = await supabase.getClient()
    .from(TABLE)
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`[apiKeys.repo] revoke: ${error.message}`);
  return rowToKey(data);
}

async function touch(id) {
  const at = new Date().toISOString();
  const { error } = await supabase.getClient()
    .from(TABLE).update({ last_used_at: at }).eq('id', id);
  if (error) throw new Error(`[apiKeys.repo] touch: ${error.message}`);
}

module.exports = {
  publicView,
  rowToKey,
  findById,
  findByHash,
  listKeys,
  listMasters,
  insert,
  update,
  revoke,
  touch,
};
