import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { resolve } from 'node:path';

import { loadEnv } from './config/env.js';
import errorHandler from './plugins/errorHandler.js';
import supabasePlugin from './plugins/supabase.js';
import swaggerPlugin from './plugins/swagger.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import quotaPlugin from './plugins/quota.js';
import healthRoutes from './modules/health/health.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import apiKeyRoutes from './modules/apiKeys/apiKeys.routes.js';
import screenshotRoutes from './modules/screenshot/screenshot.routes.js';
import bratRoutes from './modules/brat/brat.routes.js';
import quoteRoutes from './modules/quote/quote.routes.js';
import meRoutes from './modules/me/me.routes.js';
import { getBrowser, shutdown as shutdownBrowser } from './shared/browser/browserManager.js';

export interface BuildOpts {
  logger?: boolean;
}

export async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const env = loadEnv();

  // Parse TRUSTED_PROXIES into the shape Fastify expects:
  //  - "*"   → boolean true (trust every hop)
  //  - CSV   → string passed straight to proxy-addr
  // Named tokens like "loopback,linklocal,uniquelocal" are understood by
  // proxy-addr natively, so we don't need to expand them ourselves.
  const trustProxy: boolean | string =
    env.TRUSTED_PROXIES.trim() === '*' ? true : env.TRUSTED_PROXIES;

  const app = Fastify({
    logger: opts.logger
      ? {
          level: env.LOG_LEVEL,
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
              : undefined,
        }
      : false,
    trustProxy,
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Order matters:
  //  1. error handler   → catches everything
  //  2. supabase        → DB client decorator (other plugins need it)
  //  3. swagger         → must be registered BEFORE routes so it can pick them up
  //  4. auth            → adds request decorators (apiKey, user)
  //  5. rate-limit      → uses supabase + auth context
  //  6. routes
  await app.register(errorHandler);
  await app.register(import('@fastify/sensible'));
  await app.register(import('@fastify/cors'), {
    origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });

  // Backpressure guard. When event-loop is saturated or memory is high we
  // start returning 503 so upstream (e.g. WhatsApp bot) can back off
  // instead of piling on more work. Health endpoints are exempt by virtue
  // of `exposeStatusRoute: false` + our own /api/health doing nothing
  // CPU/IO heavy.
  await app.register(import('@fastify/under-pressure'), {
    maxEventLoopDelay: 1000, // 1s loop block → unhealthy
    maxHeapUsedBytes: 0, // disabled (sharp/playwright are RSS-heavy, heap is misleading)
    maxRssBytes: 1024 * 1024 * 1024, // 1 GiB; production container limits will be tighter
    maxEventLoopUtilization: 0.95,
    retryAfter: 30,
    exposeStatusRoute: false, // /api/health and /api/ready already serve liveness/readiness
    healthCheckInterval: 5000,
  });

  // Echo request id back to clients on every reply. Fastify auto-generates
  // req.id (UUID-ish counter). Surfacing it lets bot operators report
  // "request abc123 failed at 10:42" → grep server log → root cause.
  // Registered BEFORE routes so 4xx/5xx error responses also carry the id.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });

  await app.register(supabasePlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(quotaPlugin);

  // Routes — namespaced for clean Swagger grouping.
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(apiKeyRoutes, { prefix: '/api/keys' });
  await app.register(screenshotRoutes, { prefix: '/api/screenshot' });
  await app.register(bratRoutes, { prefix: '/api/brat' });
  await app.register(quoteRoutes, { prefix: '/api/quote' });
  await app.register(meRoutes, { prefix: '/api/me' });

  // Static landing page. Registered AFTER all /api/* routes so the route
  // tree is checked first — every API path is more specific than the
  // static plugin's catch-all and therefore wins. The `public/` directory
  // ships index.html + css + favicon assets; PR 3b will replace the
  // placeholder with a Vue 3 playground.
  //
  // Path resolution: STATIC_DIR env override → `<cwd>/public` default.
  // Using process.cwd() works in both `tsx` (dev) and `node dist/server.js`
  // (prod) as long as the server is launched from the project root, which
  // our `npm run dev` and `npm start` scripts do. STATIC_DIR exists so a
  // packaged container with a non-standard layout can override.
  const staticRoot = env.STATIC_DIR ?? resolve(process.cwd(), 'public');
  await app.register(import('@fastify/static'), {
    root: staticRoot,
    // No prefix → serves at `/`. wildcard: false means a request for an
    // unknown path returns 404 instead of falling through to index.html;
    // we don't want a missing-asset request to silently render HTML.
    wildcard: false,
    // index.html for `/` is automatic. dotfiles ignored by default.
  });

  // Clean URLs for the SPA-ish HTML pages. We want the address bar to
  // read `/dashboard` rather than `/dashboard.html` — looks more like
  // a product, easier to share, and decouples public URLs from the
  // file extension if we ever migrate to SSR.
  //
  // Implementation: explicit GET handlers, one per page, that delegate
  // to `reply.sendFile(...)` (provided by @fastify/static's decorator).
  // We keep the .html files reachable too — direct asset URLs still
  // resolve via the static plugin above — so existing bookmarks and
  // hard-coded references don't 404 during a rollout.
  //
  // Registration order matters: the static plugin must be registered
  // first because its `decorateReply('sendFile', …)` is what these
  // handlers rely on. The static plugin's `wildcard: false` keeps it
  // from intercepting the bare `/dashboard` path itself.
  const HTML_PAGES = ['dashboard', 'login', 'profile'] as const;
  for (const page of HTML_PAGES) {
    app.get(
      `/${page}`,
      {
        // Hidden from /docs — these aren't API endpoints, just routes
        // that serve pre-built HTML, and listing them in OpenAPI would
        // pollute the playground sidebar.
        schema: { hide: true },
      },
      (_req, reply) => reply.sendFile(`${page}.html`),
    );
  }

  // Pre-warm Chromium so the first screenshot/brat request doesn't pay the
  // ~1-2s cold-launch tax. Fire-and-forget — failure here just means the
  // first request launches normally.
  void getBrowser().catch((err) => app.log.warn({ err }, 'browser pre-warm failed'));

  // Tear down the shared Chromium when Fastify closes. Without this, every
  // SIGTERM (or dev hot-reload) leaks a chromium process — they accumulate
  // fast and exhaust container memory in production.
  app.addHook('onClose', async () => {
    await shutdownBrowser();
  });

  return app;
}
