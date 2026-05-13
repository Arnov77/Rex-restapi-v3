/**
 * Daily-usage repository — wraps the Supabase RPCs. Stateless.
 */
const logger = require('../utils/logger');
const supabase = require('../auth/supabaseClient');

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

async function checkAndIncrement(counterKey, limit) {
  const { data, error } = await supabase.getClient().rpc(RPC_INCREMENT, {
    p_date: todayLocalIsoDate(),
    p_counter: counterKey,
    p_limit: typeof limit === 'number' ? limit : -1,
  });
  if (error) {
    logger.error(`[usage.repo] RPC ${RPC_INCREMENT}: ${error.message}`);
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('[usage.repo] RPC returned empty result');
  return { allowed: !!row.allowed, used: Number(row.used), limit: Number(row.limit_value) };
}

async function getCount(counterKey) {
  const { data, error } = await supabase
    .getClient()
    .from('rex_usage_daily')
    .select('count')
    .eq('bucket_date', todayLocalIsoDate())
    .eq('counter_key', counterKey)
    .maybeSingle();
  if (error) {
    logger.error(`[usage.repo] getCount: ${error.message}`);
    return 0;
  }
  return data ? Number(data.count) : 0;
}

async function snapshot() {
  const date = todayLocalIsoDate();
  const { data, error } = await supabase
    .getClient()
    .from('rex_usage_daily')
    .select('counter_key, count')
    .eq('bucket_date', date);
  if (error) {
    logger.error(`[usage.repo] snapshot: ${error.message}`);
    return { date, counters: {} };
  }
  const counters = {};
  for (const row of data || []) counters[row.counter_key] = Number(row.count);
  return { date, counters };
}

async function transfer(fromKey, toKey) {
  const { data, error } = await supabase.getClient().rpc(RPC_TRANSFER, {
    p_date: todayLocalIsoDate(),
    p_from: fromKey,
    p_to: toKey,
  });
  if (error) {
    logger.error(`[usage.repo] RPC ${RPC_TRANSFER}: ${error.message}`);
    throw new Error(error.message);
  }
  return Number(data || 0);
}

module.exports = {
  checkAndIncrement,
  getCount,
  snapshot,
  transfer,
  todayLocalIsoDate,
  nextLocalMidnight,
};
