import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

import { loadEnv } from './config/env.js';
import errorHandler from './plugins/errorHandler.js';
import supabasePlugin from './plugins/supabase.js';
import swaggerPlugin from './plugins/swagger.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import healthRoutes from './modules/health/health.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import apiKeyRoutes from './modules/apiKeys/apiKeys.routes.js';
import screenshotRoutes from './modules/screenshot/screenshot.routes.js';
import bratRoutes from './modules/brat/brat.routes.js';
import { getBrowser } from './shared/browser/browserManager.js';

export interface BuildOpts {
  logger?: boolean;
}

export async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const env = loadEnv();

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
    trustProxy: true,
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

  await app.register(supabasePlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);

  // Routes — namespaced for clean Swagger grouping.
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(apiKeyRoutes, { prefix: '/api/keys' });
  await app.register(screenshotRoutes, { prefix: '/api/screenshot' });
  await app.register(bratRoutes, { prefix: '/api/brat' });

  // Pre-warm Chromium so the first screenshot/brat request doesn't pay the
  // ~1-2s cold-launch tax. Fire-and-forget — failure here just means the
  // first request launches normally.
  void getBrowser().catch((err) => app.log.warn({ err }, 'browser pre-warm failed'));

  return app;
}
