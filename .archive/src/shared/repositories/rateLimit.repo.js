/**
 * Persistent rate-limit counter (fixed-window) backed by Supabase RPC.
 *
 * `hit()` is the atomic gate: returns `{ allowed, count, resetAt }`.
 * Concurrent calls cannot both push the counter past `max` because the RPC's
 * UPDATE is conditional on `count < p_max`.
 */
const logger = require('../utils/logger');
const supabase = require('../auth/supabaseClient');

const RPC_HIT = 'rex_rate_limit_hit';
const RPC_GC = 'rex_rate_limit_gc';

async function hit(key, windowSec, max) {
  const { data, error } = await supabase.getClient().rpc(RPC_HIT, {
    p_key: String(key),
    p_window_s: Math.max(1, Math.floor(windowSec)),
    p_max: Math.max(0, Math.floor(max)),
  });
  if (error) {
    logger.error(`[rateLimit.repo] RPC ${RPC_HIT}: ${error.message}`);
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('[rateLimit.repo] RPC returned empty result');
  return {
    allowed: !!row.allowed,
    count: Number(row.count),
    resetAt: new Date(row.reset_at),
  };
}

async function gc(olderThan = '1 day') {
  const { data, error } = await supabase.getClient().rpc(RPC_GC, {
    p_older_than: olderThan,
  });
  if (error) {
    logger.warn(`[rateLimit.repo] RPC ${RPC_GC}: ${error.message}`);
    return 0;
  }
  return Number(data || 0);
}

module.exports = { hit, gc };
