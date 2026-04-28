const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STORE_DIR = path.join(__dirname, '../../../data');
const STORE_PATH = path.join(STORE_DIR, 'usage.json');
const ARCHIVE_DIR = path.join(__dirname, '../../../logs');

let state = null;
let dirty = false;
let flushTimer = null;
let midnightTimer = null;

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
}

function readStore() {
  ensureDir(STORE_DIR);
  if (!fs.existsSync(STORE_PATH)) return null;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.date !== 'string' || typeof parsed.counters !== 'object') {
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`[usage] store at ${STORE_PATH} unreadable (${err.message}); starting fresh`);
    return null;
  }
}

function writeStoreSync() {
  ensureDir(STORE_DIR);
  const snapshot = {
    date: state.date,
    counters: Object.fromEntries(state.counters),
    lastFlushedAt: new Date().toISOString(),
  };
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

function flush() {
  if (!dirty || !state) return;
  try {
    writeStoreSync();
    dirty = false;
  } catch (err) {
    logger.error(`[usage] flush failed: ${err.message}`);
  }
}

/**
 * Persist a snapshot of yesterday's counters to logs/usage-<date>.json before
 * the in-memory cache is cleared. Best-effort — failures here must not block
 * the reset flow.
 */
function archiveSnapshot(snapshotState) {
  try {
    ensureDir(ARCHIVE_DIR);
    const target = path.join(ARCHIVE_DIR, `usage-${snapshotState.date}.json`);
    const payload = {
      date: snapshotState.date,
      counters: Object.fromEntries(snapshotState.counters),
      archivedAt: new Date().toISOString(),
    };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), { mode: 0o600 });
  } catch (err) {
    logger.warn(`[usage] archive failed: ${err.message}`);
  }
}

function resetForNewDay() {
  if (state) archiveSnapshot(state);
  state = { date: todayLocalIsoDate(), counters: new Map() };
  dirty = true;
  flush();
}

function scheduleMidnightReset() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const msUntil = nextLocalMidnight() - new Date();
  midnightTimer = setTimeout(() => {
    logger.info(`[usage] midnight reset for ${state?.date}`);
    flush();
    resetForNewDay();
    scheduleMidnightReset();
  }, msUntil);
  if (typeof midnightTimer.unref === 'function') midnightTimer.unref();
}

/**
 * Initialise the usage store. Call once at server boot.
 *
 * On-disk state is honoured only when its `date` matches today — a server
 * that crashed yesterday and restarts after midnight would otherwise resume
 * with stale counters.
 */
function start({ flushIntervalSec = 60 } = {}) {
  const persisted = readStore();
  const today = todayLocalIsoDate();
  if (persisted && persisted.date === today) {
    state = { date: today, counters: new Map(Object.entries(persisted.counters)) };
    dirty = false;
  } else {
    if (persisted)
      archiveSnapshot({
        date: persisted.date,
        counters: new Map(Object.entries(persisted.counters)),
      });
    state = { date: today, counters: new Map() };
    dirty = true;
    flush();
  }

  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(flush, flushIntervalSec * 1000);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();

  scheduleMidnightReset();
  logger.info(
    `[usage] store ready (date=${state.date}, entries=${state.counters.size}, ` +
      `flush every ${flushIntervalSec}s, reset at midnight local time)`
  );
}

function stop() {
  if (flushTimer) clearInterval(flushTimer);
  if (midnightTimer) clearTimeout(midnightTimer);
  flushTimer = null;
  midnightTimer = null;
  flush();
}

function getCount(key) {
  if (!state) return 0;
  return state.counters.get(key) || 0;
}

function increment(key) {
  if (!state) return 1;
  const next = (state.counters.get(key) || 0) + 1;
  state.counters.set(key, next);
  dirty = true;
  return next;
}

function snapshot() {
  if (!state) return { date: todayLocalIsoDate(), counters: {} };
  return {
    date: state.date,
    counters: Object.fromEntries(state.counters),
  };
}

function _resetForTests() {
  if (flushTimer) clearInterval(flushTimer);
  if (midnightTimer) clearTimeout(midnightTimer);
  flushTimer = null;
  midnightTimer = null;
  state = null;
  dirty = false;
}

module.exports = {
  start,
  stop,
  getCount,
  increment,
  snapshot,
  resetForNewDay,
  flush,
  todayLocalIsoDate,
  nextLocalMidnight,
  _resetForTests,
  _STORE_PATH: STORE_PATH,
  _ARCHIVE_DIR: ARCHIVE_DIR,
};
