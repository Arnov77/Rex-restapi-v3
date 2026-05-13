const logger = require('../utils/logger');
const supabase = require('./supabaseClient');

const RPC_INCREMENT = 'rex_increment_usage';
const RPC_TRANSFER = 'rex_transfer_usage';

function todayLocalIsoDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextLocalMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

/**
 * Atomic check-and-increment for a daily counter. Race-free even under
 * heavy concurrency — the conditional UPDATE inside the RPC is the gate.
 *
 * @param {string} counterKey
 * @param {number} limit  Pass a negative number for unlimited.
 * @returns {Promise<{allowed:boolean, used:number, limit:number}>}
 */
async function checkAndIncrement(counterKey, limit) {
  const { data, error } = await supabase.getClient().rpc(RPC_INCREMENT, {
    p_date: todayLocalIsoDate(),
    p_counter: counterKey,
    p_limit: typeof limit === 'number' ? limit : -1,
  });
  if (error) {
    logger.error(`[usage] RPC ${RPC_INCREMENT} failed: ${error.message}`);
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('[usage] RPC returned empty result');
  return { allowed: !!row.allowed, used: Number(row.used), limit: Number(row.limit_value) };
}

/**
 * Read-only count for the current day. Used by the user-profile endpoint
 * (`buildUsageView`) to display "X / Y used today". Returns 0 if no row yet.
 */
async function getCount(counterKey) {
  const { data, error } = await supabase
    .getClient()
    .from('rex_usage_daily')
    .select('count')
    .eq('bucket_date', todayLocalIsoDate())
    .eq('counter_key', counterKey)
    .maybeSingle();
  if (error) {
    logger.error(`[usage] getCount failed: ${error.message}`);
    return 0;
  }
  return data ? Number(data.count) : 0;
}

/**
 * Snapshot of all counters for today. Used by the admin usage endpoint.
 * Returns { date, counters: { [counterKey]: count } }.
 */
async function snapshot() {
  const date = todayLocalIsoDate();
  const { data, error } = await supabase
    .getClient()
    .from('rex_usage_daily')
    .select('counter_key, count')
    .eq('bucket_date', date);
  if (error) {
    logger.error(`[usage] snapshot failed: ${error.message}`);
    return { date, counters: {} };
  }
  const counters = {};
  for (const row of data || []) counters[row.counter_key] = Number(row.count);
  return { date, counters };
}

/**
 * Move today's counter from one key to another atomically. Used when an
 * API key is regenerated and we want the new key id to inherit the old
 * key's day-to-date usage.
 */
async function transfer(fromKey, toKey) {
  const { data, error } = await supabase.getClient().rpc(RPC_TRANSFER, {
    p_date: todayLocalIsoDate(),
    p_from: fromKey,
    p_to: toKey,
  });
  if (error) {
    logger.error(`[usage] RPC ${RPC_TRANSFER} failed: ${error.message}`);
    throw new Error(error.message);
  }
  return Number(data || 0);
}

function _resetForTests() {
  /* no-op — store is stateless. Kept for API parity with old version. */
}

module.exports = {
  checkAndIncrement,
  getCount,
  snapshot,
  transfer,
  todayLocalIsoDate,
  nextLocalMidnight,
  _resetForTests,
};
