const pino = require('pino');
const { env, isProd, isTest } = require('../../../config');

// Pino is the runtime logger. In development we pipe through pino-pretty for
// a human-readable coloured output; in production we emit structured JSON
// straight to stdout so log collectors (Loki, CloudWatch, etc.) can index it.
const basePino = pino({
  level: env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // Silence during `vitest run` so the test runner's own summary stays clean.
  enabled: !isTest,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: undefined, // Drop pid/hostname — not useful for this single-node API.
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
});

// Back-compat shim: the codebase calls logger.info(msg) / logger.success(msg)
// with plain strings. Pino's signature is the opposite (obj, msg) — and it
// doesn't have a .success level. This wrapper lets every existing call site
// keep working unchanged while also accepting (obj, msg) for new code.
function wrap(level) {
  return (arg1, arg2) => {
    if (typeof arg1 === 'string') {
      basePino[level](arg1);
    } else if (arg1 instanceof Error) {
      basePino[level]({ err: arg1 }, arg2 || arg1.message);
    } else {
      basePino[level](arg1, arg2);
    }
  };
}

module.exports = {
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
  debug: wrap('debug'),
  // Pino has no "success" level — alias to info so existing call sites work.
  // The message itself (e.g. "Server running at ...") stays self-describing.
  success: wrap('info'),
  // Exposed for pino-http integration in server.js — it needs the raw pino
  // instance to reuse the same destination + formatting.
  _pino: basePino,
};
