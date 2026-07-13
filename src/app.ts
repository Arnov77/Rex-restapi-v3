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

//========[Tools]=======
import screenshotRoutes from './modules/tools/screenshot/screenshot.routes.js';
import tgstickerRoutes from './modules/tools/tgsticker/sticker.routes.js';
import exifRoutes from './modules/tools/exif/exif.routes.js';
import shortlinkRoutes from './modules/tools/shortlinks/shortlinks.routes.js';
import qrRoutes from './modules/tools/qr/qr.routes.js';
import iplookupRoutes from './modules/tools/iplookup/iplookup.routes.js';
import translateRoutes from './modules/tools/translate/translate.routes.js';
import { shortlinksService } from './modules/tools/shortlinks/shortlinks.service.js';
// import hitamRoutes from './modules/tools/hitam/skinfilter.routes.js';
import removebgRoutes from './modules/tools/removebg/removebg.routes.js';
import changebgRoutes from './modules/tools/removebg/changebg.routes.js';
import ttsRoutes from './modules/tools/tts/tts.routes.js';
import ocrRoutes from './modules/tools/ocr/ocr.routes.js';
import animeRoutes from './modules/tools/anime/anime.routes.js';
import hitamRoutes from './modules/tools/hitam/hitam.routes.js';
import tofigureRoutes from './modules/tools/tofigure/tofigure.routes.js';
import nsfwRoutes from './modules/tools/nsfw/nsfw.routes.js';
import randomMemeRoutes from './modules/tools/randomsticker/randomsticker.routes.js';
import randomStickerAdminRoutes from './modules/tools/randomsticker/randomsticker.admin.routes.js';

//=========[Makers]========
import bratRoutes from './modules/makers/brat/brat.routes.js';
import quoteRoutes from './modules/makers/quote/quote.routes.js';
import iqcRoutes from './modules/makers/iqc/iqc.routes.js';
import qcRoutes from './modules/makers/qc/qc.routes.js';
import miqRoutes from './modules/makers/miq/miq.routes.js';
import smemeRoutes from './modules/makers/smeme/smeme.routes.js';
import lqRoutes from './modules/makers/lq/lq.routes.js';
import vcRoutes from './modules/makers/vc/vc.routes.js';
import achievementRoutes from './modules/makers/achievement/achievement.routes.js';

//=======[AI]=======
import imagegenRoutes from './modules/ai/imagegen/imagegen.routes.js';
import sttRoutes from './modules/ai/stt/stt.routes.js';
import muslimAiRoutes from './modules/ai/muslim/muslimAi.routes.js';
import heruRoutes from './modules/ai/heru/heru.routes.js';

//======[DOWNLOADERS]========
import proxyRoutes from './modules/downloaders/_proxy/proxy.routes.js';
import shortRoutes from './modules/downloaders/_proxy/short.routes.js';
import tiktokRoutes from './modules/downloaders/tiktok/tiktok.routes.js';
import twitterRoutes from './modules/downloaders/twitter/twitter.routes.js';
import instagramRoutes from './modules/downloaders/instagram/instagram.routes.js';
import facebookRoutes from './modules/downloaders/facebook/facebook.routes.js';
import youtubeRoutes from './modules/downloaders/youtube/youtube.routes.js';
import ytmp3Routes from './modules/downloaders/youtube/ytmp3.routes.js';
import ytplayRoutes from './modules/downloaders/youtube/ytplay.routes.js';
import ttmp3Routes from './modules/downloaders/tiktok/ttmp3.routes.js';
import igmp3Routes from './modules/downloaders/instagram/igmp3.routes.js';
import pinterestRoutes from './modules/downloaders/pinterest/pinterest.routes.js';
import mediafireRoutes from './modules/downloaders/mediafire/mediafire.routes.js';
import spotifyRoutes from './modules/downloaders/spotify/spotify.routes.js';
import soundCloudRoutes from './modules/downloaders/soundcloud/soundcloud.routes.js';

//======[SEARCH]======
import pinSearch from './modules/search/pinterest/pinterest.routes.js';
import mangaRoutes from './modules/search/manga/manga.routes.js';

//=======[GAMES]=======
import asahotakRoutes from './modules/games/asahotak/asahotak.routes.js';
import caklontongRoutes from './modules/games/caklontong/caklontong.routes.js';
import family100Routes from './modules/games/family100/family100.routes.js';
import siapakahakuRoutes from './modules/games/siapakahaku/siapakahaku.routes.js';
import susunkataRoutes from './modules/games/susunkata/susunkata.routes.js';
import tebakbenderaRoutes from './modules/games/tebakbendera/tebakbendera.routes.js';
import tebakbendera2Routes from './modules/games/tebakbendera2/tebakbendera2.routes.js';
import tebakgambarRoutes from './modules/games/tebakgambar/tebakgambar.routes.js';
import tebakkabupatenRoutes from './modules/games/tebakkabupaten/tebakkabupaten.routes.js';
import tebakkalimatRoutes from './modules/games/tebakkalimat/tebakkalimat.routes.js';
import tebakkataRoutes from './modules/games/tebakkata/tebakkata.routes.js';
import tebakkimiaRoutes from './modules/games/tebakkimia/tebakkimia.routes.js';
import tebaklirikRoutes from './modules/games/tebaklirik/tebaklirik.routes.js';
import tebaktebakanRoutes from './modules/games/tebaktebakan/tebaktebakan.routes.js';
import tekatekiRoutes from './modules/games/tekateki/tekateki.routes.js';

//=================[FUN]=================
import cekkodamRoutes from './modules/fun/cek-kodam/cekkodam.routes.js';
import cekprimbonRoutes from './modules/fun/primbon/primbon.routes.js';

//===============================================
import meRoutes from './modules/me/me.routes.js';
import auditLogRoutes from './modules/auditLog/auditLog.routes.js';
import adminUsersRoutes from './modules/adminUsers/adminUsers.routes.js';
import { getBrowser, shutdown as shutdownBrowser } from './shared/browser/browserManager.js';

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
  
  //=======[Tools]=======
  await app.register(screenshotRoutes, { prefix: '/api/tools/screenshot' });
  await app.register(exifRoutes, { prefix: '/api/tools/exif' });
  await app.register(shortlinkRoutes, { prefix: '/api/tools/shortlink' });
  await app.register(qrRoutes, { prefix: '/api/tools/qr' });
  await app.register(iplookupRoutes, { prefix: '/api/tools/iplookup' });
  await app.register(translateRoutes, { prefix: '/api/tools/translate' });
  await app.register(ttsRoutes, { prefix: '/api/tools/tts' });
  await app.register(removebgRoutes, { prefix: '/api/tools/removebg' });
  await app.register(changebgRoutes, { prefix: '/api/tools/changebg' });
  await app.register(ocrRoutes, { prefix: '/api/tools/ocr' });
  await app.register(animeRoutes, { prefix: '/api/tools/anime' });
  await app.register(hitamRoutes, { prefix: '/api/tools/hitam' });
  await app.register(tofigureRoutes, { prefix: '/api/tools/tofigure' });
  await app.register(nsfwRoutes, { prefix: '/api/tools/nsfw' });
  await app.register(randomMemeRoutes, { prefix: '/api/tools/random-sticker' });
  await app.register(randomStickerAdminRoutes, { prefix: '/api/admin/randomSticker/packs' });
  
  //=======[MAKERS]=======
  await app.register(tgstickerRoutes, { prefix: '/api/maker/tgsticker' });
  await app.register(bratRoutes, { prefix: '/api/maker/brat' });
  await app.register(quoteRoutes, { prefix: '/api/maker/quote' });
  await app.register(iqcRoutes, { prefix: '/api/maker/iqc' });
  await app.register(qcRoutes, { prefix: '/api/maker/qc' });
  await app.register(miqRoutes, { prefix: '/api/maker/miq' });
  await app.register(smemeRoutes, { prefix: '/api/maker/smeme' });
  await app.register(lqRoutes, { prefix: '/api/maker/lq' });
  await app.register(achievementRoutes, { prefix: '/api/maker/achievement' });
  await app.register(vcRoutes, { prefix: '/api/maker/vc' });
  
  //=======[AI]======
  await app.register(imagegenRoutes, { prefix: '/api/ai/imagegen' });
  await app.register(sttRoutes, { prefix: '/api/ai/stt' });
  await app.register(muslimAiRoutes, { prefix: '/api/ai/muslim-ai' });
  await app.register(heruRoutes, { prefix: '/api/ai/heru-ai' });
  
  //======[DOWNLOADERS]=======
  await app.register(proxyRoutes, { prefix: '/api/downloader/proxy' });
  await app.register(shortRoutes, { prefix: '/p' });
  await app.register(tiktokRoutes, { prefix: '/api/downloader/tiktok' });
  await app.register(twitterRoutes, { prefix: '/api/downloader/twitter' });
  await app.register(instagramRoutes, { prefix: '/api/downloader/instagram' });
  await app.register(facebookRoutes, { prefix: '/api/downloader/facebook' });
  await app.register(youtubeRoutes, { prefix: '/api/downloader/youtube' });
  await app.register(ytmp3Routes, { prefix: '/api/downloader/ytmp3' });
  await app.register(ytplayRoutes, { prefix: '/api/downloader/ytplay' });
  await app.register(ttmp3Routes, { prefix: '/api/downloader/ttmp3' });
  await app.register(igmp3Routes, { prefix: '/api/downloader/igmp3' });
  await app.register(pinterestRoutes, { prefix: '/api/downloader/pinterest' });
  await app.register(mediafireRoutes, { prefix: '/api/downloader/mediafire' });
  await app.register(spotifyRoutes, { prefix: '/api/downloader/spotify' });
  await app.register(soundCloudRoutes, { prefix: '/api/downloader/soundcloud' });
  
  //======[SEARCH]=====
  await app.register(pinSearch, { prefix: '/api/search/pinterest' });
  await app.register(mangaRoutes, { prefix: '/api/search/manga' });

  //========[GAMES]=======
  await app.register(asahotakRoutes, { prefix: '/api/games/asahotak' });
  await app.register(caklontongRoutes, { prefix: '/api/games/caklontong' });
  await app.register(family100Routes, { prefix: '/api/games/family100' });
  await app.register(siapakahakuRoutes, { prefix: '/api/games/siapakahaku' });
  await app.register(susunkataRoutes, { prefix: '/api/games/susunkata' });
  await app.register(tebakbenderaRoutes, { prefix: '/api/games/tebakbendera' });
  await app.register(tebakbendera2Routes, { prefix: '/api/games/tebakbendera2' });
  await app.register(tebakgambarRoutes, { prefix: '/api/games/tebakgambar' });
  await app.register(tebakkabupatenRoutes, { prefix: '/api/games/tebakkabupaten' });
  await app.register(tebakkalimatRoutes, { prefix: '/api/games/tebakkalimat' });
  await app.register(tebakkataRoutes, { prefix: '/api/games/tebakkata' });
  await app.register(tebakkimiaRoutes, { prefix: '/api/games/tebakkimia' });
  await app.register(tebaklirikRoutes, { prefix: '/api/games/tebaklirik' });
  await app.register(tebaktebakanRoutes, { prefix: '/api/games/tebaktebakan' });
  await app.register(tekatekiRoutes, { prefix: '/api/games/tekateki' });
  
  //=================[FUN]=================
  await app.register(cekkodamRoutes, { prefix: '/api/fun/cek-kodam' });
  await app.register(cekprimbonRoutes, { prefix: '/api/fun/primbon' });

  //============≠===========≠========
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(auditLogRoutes, { prefix: '/api/keys/audit-log' });
  await app.register(adminUsersRoutes, { prefix: '/api/admin/users' });

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
