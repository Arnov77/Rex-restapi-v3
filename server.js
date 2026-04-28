const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');

const { env } = require('./config');
const logger = require('./src/shared/utils/logger');
const { errorHandler } = require('./src/shared/middleware/errorHandler');
const { generalLimiter } = require('./src/shared/middleware/rateLimiter');
const {
  tieredApiLimiter,
  tieredHeavyLimiter,
  tieredAiLimiter,
} = require('./src/shared/middleware/tieredLimiter');
const { apiKeyAuth } = require('./src/shared/auth/apiKeyAuth');
const apiKeyStore = require('./src/shared/auth/apiKeyStore');
const requestId = require('./src/shared/middleware/requestId');
const ResponseHandler = require('./src/shared/utils/response');
const browserManager = require('./src/shared/browser/browserManager');
const { initColorIndex } = require('./src/core/media/brat/color');
const swaggerSpec = require('./src/shared/docs/swagger');
const downloadsCleanup = require('./src/shared/utils/downloadsCleanup');

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
const replicateRoute = require('./src/core/ai/replicate/replicate.routes');
const adminRoute = require('./src/core/admin/admin.routes');

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

// API key middleware runs before per-route limiters so each limiter can
// branch on req.apiKey?.tier (anon / user / master). Unauthenticated requests
// still pass through — the tiered limiters apply tighter caps to them.
app.use(apiKeyAuth);

// ── Route mounts ─────────────────────────────────────────────────────────────
// Heavy endpoints (browser automation + large transcodes) get the tighter
// tieredHeavyLimiter; everything else gets tieredApiLimiter. Each limiter
// scales the cap by req.apiKey.tier (anon / user / master).
app.use('/api/admin', adminRoute);
app.use('/api/youtube', tieredHeavyLimiter, youtubeRoutes);
app.use('/api/brat', tieredHeavyLimiter, bratRoutes);
app.use('/api/tiktok', tieredApiLimiter, tiktokRoutes);
app.use('/api/instagram', tieredApiLimiter, instagramRoutes);
app.use('/api/gdrive', tieredApiLimiter, gdriveRoute);
app.use('/api/quote', tieredHeavyLimiter, quoteRoute);
app.use('/api/smeme', tieredApiLimiter, smemeRoute);
app.use('/api/promosi', tieredApiLimiter, promosiRoute);
app.use('/api/miq', tieredApiLimiter, miqRoute);
app.use('/api/telegram', tieredHeavyLimiter, telegramRoute);
app.use('/api/replicate', tieredAiLimiter, replicateRoute);
app.use('/mcapi', tieredApiLimiter, mcprofileRoute);

// OpenAPI / Swagger UI — the JSON spec is published at /api/docs.json for
// scripted clients and the interactive explorer at /api/docs for humans.
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

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
    // Pre-warm the brat color index so the first request doesn't pay a one-off
    // dynamic-import + JSON-parse cost (~150ms on cold start).
    await initColorIndex();

    apiKeyStore.ensureMasterKey();

    // Sweep stale files in /downloads on a TTL so the disk doesn't fill up
    // with old YouTube/TikTok artefacts. Runs an initial pass synchronously,
    // then schedules an interval. unref()'d so it never blocks shutdown.
    downloadsCleanup.startCleanup(path.join(__dirname, 'downloads'));

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
  downloadsCleanup.stopCleanup();
  apiKeyStore.flushPendingTouches();
  if (!httpServer) {
    browserManager.shutdown().finally(() => process.exit(0));
    return;
  }
  httpServer.close(async (err) => {
    if (err) {
      logger.error(`Error during shutdown: ${err.message}`);
      // Still try to close Chromium so we don't leave zombie processes.
      await browserManager.shutdown().catch(() => {});
      process.exit(1);
    }
    logger.info('HTTP server closed, draining browser pool...');
    await browserManager.shutdown().catch(() => {});
    logger.info('Bye.');
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
