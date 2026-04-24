const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');
const path = require('path');
const fs = require('fs');

const { env } = require('./config');
const logger = require('./src/shared/utils/logger');
const { errorHandler } = require('./src/shared/middleware/errorHandler');
const { generalLimiter, apiLimiter, heavyLimiter } = require('./src/shared/middleware/rateLimiter');
const requestId = require('./src/shared/middleware/requestId');
const ResponseHandler = require('./src/shared/utils/response');

const youtubeRoutes = require('./src/core/media/youtube/youtube.routes');
const bratRoutes = require('./src/core/media/brat/brat.routes');
const tiktokRoutes = require('./src/core/media/tiktok/tiktok.routes');
const instagramRoutes = require('./src/core/media/instagram/instagram.routes');

const gdriveRoute = require('./src/core/tools/gdrive/gdrive.routes');
const quoteRoute = require('./src/core/tools/quote/quote.routes');
const smemeRoute = require('./src/core/tools/smeme/smeme.routes');
const promosiRoute = require('./src/core/tools/promosi/promosi.routes');
const mcprofileRoute = require('./src/core/tools/mcprofile/mcprofile.routes');
const miqRoute = require('./src/core/tools/miq/miq.routes');
const telegramRoute = require('./src/core/tools/telegram/telegram.routes');

const app = express();

// Trust proxy hops (Render/Railway/Cloudflare all add one). Required for
// express-rate-limit to read the client IP correctly.
app.set('trust proxy', env.TRUST_PROXY);

// Ensure the working directories a few routes rely on exist. Done once at
// boot so handlers never have to guard against ENOENT on the happy path.
for (const dirname of ['temp', 'logs', 'downloads']) {
  const target = path.join(__dirname, dirname);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
}

// ── Core middleware (runs before routes, in deliberate order) ────────────────
// 1. requestId first so every subsequent log line can reference it.
// 2. helmet / compression — transport-level concerns.
// 3. cors — after helmet so its headers aren't shadowed.
// 4. pino-http request log (structured, reuses req.id from step 1).
// 5. body parsers — tight limit (multipart uploads bypass these).
// 6. generalLimiter — blanket abuse guard before route dispatch.
app.use(requestId);
app.use(
  helmet({
    // Serving API JSON + a public static dir — CSP adds little here and
    // frequently breaks Swagger UI (planned for /api/docs in PR-5).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(compression());
app.use(cors());
app.use(
  pinoHttp({
    logger: logger._pino,
    // Reuse the UUID minted by the requestId middleware so a single request
    // spans exactly one correlation id from edge to error log.
    genReqId: (req) => req.id,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Skip health/status from per-request logs — they spam the output and
    // tell us nothing about user traffic.
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/api/status',
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

const bodyLimit = `${env.BODY_LIMIT_MB}mb`;
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

// Static assets. The `public/` dir holds the marketing landing page; the
// `downloads/` dir exposes artefacts produced by media routes. The legacy
// `/download` alias was removed — callers should use `/downloads`.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

app.use(generalLimiter);

// ── Route mounts ─────────────────────────────────────────────────────────────
// Heavy endpoints (browser automation + large transcodes) get the tighter
// heavyLimiter; everything else gets the standard apiLimiter.
app.use('/api/youtube', heavyLimiter, youtubeRoutes);
app.use('/api/brat', heavyLimiter, bratRoutes);
app.use('/api/tiktok', apiLimiter, tiktokRoutes);
app.use('/api/instagram', apiLimiter, instagramRoutes);
app.use('/api/gdrive', apiLimiter, gdriveRoute);
app.use('/api/quote', heavyLimiter, quoteRoute);
app.use('/api/smeme', apiLimiter, smemeRoute);
app.use('/api/promosi', apiLimiter, promosiRoute);
app.use('/api/miq', apiLimiter, miqRoute);
app.use('/api/telegram', heavyLimiter, telegramRoute);
app.use('/mcapi', apiLimiter, mcprofileRoute);

app.get('/health', (req, res) =>
  ResponseHandler.success(
    res,
    { status: 'healthy', uptime: process.uptime() },
    'Health check passed'
  )
);

app.get('/api/status', (req, res) =>
  ResponseHandler.success(
    res,
    {
      version: env.API_VERSION,
      environment: env.NODE_ENV,
      uptime: Math.floor(process.uptime()),
    },
    'API is running'
  )
);

// 404 handler — runs after every mounted router failed to match.
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.path}`);
  return ResponseHandler.error(res, 'Endpoint not found', 404);
});

// Error handler — MUST be last.
app.use(errorHandler);

// ── Lifecycle ────────────────────────────────────────────────────────────────
let httpServer;

async function startServer() {
  try {
    const utils = require('./src/utils/utils');
    await utils.init();

    httpServer = app.listen(env.PORT, () => {
      logger.success(`Server running at http://localhost:${env.PORT}`);
      logger.info(`Health check: http://localhost:${env.PORT}/health`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Graceful shutdown — stop accepting connections, drain in-flight requests,
// then exit. Hard-kill after 15s in case something (browser worker, long
// download) refuses to finish. Covers SIGTERM (docker stop / orchestrator)
// and SIGINT (Ctrl-C).
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  if (!httpServer) {
    process.exit(0);
  }
  httpServer.close((err) => {
    if (err) {
      logger.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    }
    logger.info('HTTP server closed, bye.');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Shutdown timeout exceeded, forcing exit.');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = app;
