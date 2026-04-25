const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Files older than TTL_MS are deleted. The sweep itself runs every SWEEP_MS.
// Defaults: keep files for 1 hour, sweep every 5 minutes. Both can be overridden
// via env (DOWNLOADS_TTL_MIN / DOWNLOADS_SWEEP_MIN) without code changes.
const DEFAULT_TTL_MIN = 60;
const DEFAULT_SWEEP_MIN = 5;

function getTtlMs() {
  const m = parseInt(process.env.DOWNLOADS_TTL_MIN || '', 10);
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_TTL_MIN) * 60 * 1000;
}

function getSweepMs() {
  const m = parseInt(process.env.DOWNLOADS_SWEEP_MIN || '', 10);
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_SWEEP_MIN) * 60 * 1000;
}

let timer = null;

// One sweep pass: stat every file, unlink anything whose mtime is older than
// the TTL. Errors per-file are logged but never propagate — a single weird
// file shouldn't stop the sweep. Returns { deleted, kept, failed }.
function sweepOnce(downloadDir, ttlMs) {
  let deleted = 0;
  let kept = 0;
  let failed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(downloadDir);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`[cleanup] readdir(${downloadDir}) failed: ${err.message}`);
    }
    return { deleted, kept, failed };
  }

  const cutoff = Date.now() - ttlMs;
  for (const name of entries) {
    const full = path.join(downloadDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) {
        kept += 1;
        continue;
      }
      if (st.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted += 1;
      } else {
        kept += 1;
      }
    } catch (err) {
      // ENOENT here means another process raced us; not an error.
      if (err.code !== 'ENOENT') {
        failed += 1;
        logger.warn(`[cleanup] failed to handle ${name}: ${err.message}`);
      }
    }
  }
  return { deleted, kept, failed };
}

function startCleanup(downloadDir) {
  if (timer) return; // idempotent

  const ttlMs = getTtlMs();
  const sweepMs = getSweepMs();

  // Run an immediate pass at boot so anything left over from the previous
  // process gets cleaned up as soon as the server is healthy.
  const initial = sweepOnce(downloadDir, ttlMs);
  logger.info(
    `[cleanup] downloads/ initial sweep: deleted=${initial.deleted} kept=${initial.kept} failed=${initial.failed} (ttl=${ttlMs / 60000}min, every ${sweepMs / 60000}min)`
  );

  timer = setInterval(() => {
    const result = sweepOnce(downloadDir, ttlMs);
    if (result.deleted > 0 || result.failed > 0) {
      logger.info(
        `[cleanup] downloads/ swept: deleted=${result.deleted} kept=${result.kept} failed=${result.failed}`
      );
    }
  }, sweepMs);
  // Don't keep the event loop alive just for the sweeper.
  timer.unref?.();
}

function stopCleanup() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startCleanup,
  stopCleanup,
  // Exported for tests.
  sweepOnce,
};
