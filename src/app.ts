import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');

import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
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
import screenshotRoutes from './modules/tools/screenshot/screenshot.routes.js';
import tgstickerRoutes from './modules/tools/tgsticker/sticker.routes.js';
import bratRoutes from './modules/makers/brat/brat.routes.js';
import quoteRoutes from './modules/makers/quote/quote.routes.js';
import iqcRoutes from './modules/makers/iqc/iqc.routes.js';
import qcRoutes from './modules/makers/qc/qc.routes.js';
import miqRoutes from './modules/makers/miq/miq.routes.js';
import smemeRoutes from './modules/makers/smeme/smeme.routes.js';
import lqRoutes from './modules/makers/lq/lq.routes.js';
import vcRoutes from './modules/makers/vc/vc.routes.js';
import exifRoutes from './modules/tools/exif/exif.routes.js';
import shortlinkRoutes from './modules/tools/shortlinks/shortlinks.routes.js';
import qrRoutes from './modules/tools/qr/qr.routes.js';
import iplookupRoutes from './modules/tools/iplookup/iplookup.routes.js';
import translateRoutes from './modules/tools/translate/translate.routes.js';
// import hitamRoutes from './modules/tools/hitam/skinfilter.routes.js';
import imagegenRoutes from './modules/ai/imagegen/imagegen.routes.js';
import sttRoutes from './modules/ai/stt/stt.routes.js';
import meRoutes from './modules/me/me.routes.js';
import auditLogRoutes from './modules/auditLog/auditLog.routes.js';
import adminUsersRoutes from './modules/adminUsers/adminUsers.routes.js';
import proxyRoutes from './modules/downloaders/_proxy/proxy.routes.js';
import shortRoutes from './modules/downloaders/_proxy/short.routes.js';
import tiktokRoutes from './modules/downloaders/tiktok/tiktok.routes.js';
import twitterRoutes from './modules/downloaders/twitter/twitter.routes.js';
import instagramRoutes from './modules/downloaders/instagram/instagram.routes.js';
import facebookRoutes from './modules/downloaders/facebook/facebook.routes.js';
import youtubeRoutes from './modules/downloaders/youtube/youtube.routes.js';
import ytmp3Routes from './modules/downloaders/youtube/ytmp3.routes.js';
import ttmp3Routes from './modules/downloaders/tiktok/ttmp3.routes.js';
import igmp3Routes from './modules/downloaders/instagram/igmp3.routes.js';
import pinterestRoutes from './modules/downloaders/pinterest/pinterest.routes.js';
import { getBrowser, shutdown as shutdownBrowser } from './shared/browser/browserManager.js';
import { shortlinksService } from './modules/tools/shortlinks/shortlinks.service.js';

export interface BuildOpts {
  logger?: boolean;
}

export async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const env = loadEnv();

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

  await app.register(errorHandler);
  await app.register(import('@fastify/sensible'));

  const corsWildcard = env.CORS_ORIGINS.trim() === '*';
  await app.register(import('@fastify/cors'), {
    origin: corsWildcard ? '*' : env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: !corsWildcard,
  });
  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });

  await app.register(import('@fastify/under-pressure'), {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 0,
    maxRssBytes: 1024 * 1024 * 1024,
    maxEventLoopUtilization: 0.95,
    retryAfter: 30,
    exposeStatusRoute: false,
    healthCheckInterval: 5000,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });

  await app.register(supabasePlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(quotaPlugin);

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB
      files: 1,
    },
  });

  // Routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(apiKeyRoutes, { prefix: '/api/keys' });
  await app.register(screenshotRoutes, { prefix: '/api/screenshot' });
  await app.register(tgstickerRoutes, { prefix: '/api/tgsticker' });
  await app.register(bratRoutes, { prefix: '/api/brat' });
  await app.register(quoteRoutes, { prefix: '/api/quote' });
  await app.register(iqcRoutes, { prefix: '/api/iqc' });
  await app.register(qcRoutes, { prefix: '/api/qc' });
  await app.register(miqRoutes, { prefix: '/api/miq' });
  await app.register(smemeRoutes, { prefix: '/api/smeme' });
  await app.register(lqRoutes, { prefix: '/api/lq' });
  await app.register(vcRoutes, { prefix: '/api/vc' });
  await app.register(exifRoutes, { prefix: '/api/exif' });
  await app.register(shortlinkRoutes, { prefix: '/api/shortlink' });
  await app.register(qrRoutes, { prefix: '/api/qr' });
  await app.register(iplookupRoutes, { prefix: '/api/tools/iplookup' });
  await app.register(translateRoutes, { prefix: '/api/tools/translate' });
  // await app.register(hitamRoutes, { prefix: '/api/hitam' });
  await app.register(imagegenRoutes, { prefix: '/api/ai/imagegen' });
  await app.register(sttRoutes, { prefix: '/api/ai/stt' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(auditLogRoutes, { prefix: '/api/keys/audit-log' });
  await app.register(adminUsersRoutes, { prefix: '/api/admin/users' });
  await app.register(proxyRoutes, { prefix: '/api/download/proxy' });
  await app.register(shortRoutes, { prefix: '/p' });
  await app.register(tiktokRoutes, { prefix: '/api/download/tiktok' });
  await app.register(twitterRoutes, { prefix: '/api/download/twitter' });
  await app.register(instagramRoutes, { prefix: '/api/download/instagram' });
  await app.register(facebookRoutes, { prefix: '/api/download/facebook' });
  await app.register(youtubeRoutes, { prefix: '/api/download/youtube' });
  await app.register(ytmp3Routes, { prefix: '/api/download/ytmp3' });
  await app.register(ttmp3Routes, { prefix: '/api/download/ttmp3' });
  await app.register(igmp3Routes, { prefix: '/api/download/igmp3' });
  await app.register(pinterestRoutes, { prefix: '/api/download/pinterest' });

  // Shortlink redirect
  const resolveAndRedirect = async (
    req: { params: unknown },
    reply: { header: (k: string, v: string) => any; code: (n: number) => any },
  ) => {
    const { id } = req.params as { id: string };
    const svc = shortlinksService(app.supabase);
    try {
      const link = await svc.resolve(id);
      return (reply as any).header('cache-control', 'no-store').redirect(link.url, 301);
    } catch {
      return (reply as any).code(404).send('Shortlink not found or expired');
    }
  };

  app.get('/s/:id', { schema: { hide: true } }, resolveAndRedirect as any);

  const staticRoot = env.STATIC_DIR ?? resolve(process.cwd(), 'public');
  await app.register(import('@fastify/static'), {
    root: staticRoot,
    wildcard: false,
  });

  const HTML_PAGES = ['dashboard', 'login', 'profile', 'admin'] as const;
  for (const page of HTML_PAGES) {
    app.get(
      `/${page}`,
      { schema: { hide: true } },
      (_req, reply) => reply.sendFile(`${page}.html`),
    );
  }

  if (env.SHORTLINK_BASE_URL) {
    app.get('/:id', { schema: { hide: true } }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(id)) {
        return reply.code(404).send('Not found');
      }
      return resolveAndRedirect(req as any, reply as any);
    });
  }

  void getBrowser().catch((err) => app.log.warn({ err }, 'browser pre-warm failed'));

  app.addHook('onClose', async () => {
    await shutdownBrowser();
  });

  return app;
}