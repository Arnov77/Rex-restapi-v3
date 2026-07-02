import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { memeStickerService } from './memesticker.service.js';
import { memeStickerPacksRepo } from './memesticker.repo.js';
import { MemeStickerQuery } from './memesticker.schemas.js';

const memeStickerRoutes: FastifyPluginAsyncZod = async (app) => {
/*
  const quota = app.quota({ message: 'Daily sticker quota exceeded' });
  const limit = app.rateLimit({
    prefix: 'memesticker',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many sticker requests',
  });*/

  app.get(
    '/',
    {
      // preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'Get a random Indonesian meme sticker. Params: format, quality, pack (optional)',
        querystring: MemeStickerQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const result = await memeStickerService.getRandomMemeSticker(app.supabase, req.query, ac.signal);
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="meme-sticker.${ext}"`)
        .header('cache-control', 'no-store')
        .header('x-animated', result.isAnimated ? '1' : '0')
        .header('x-pack', result.pack)
        .send(result.buffer);
    },
  );

  // List pack aktif yang dipakai (berguna buat debugging / pilih pack spesifik)
  app.get(
    '/packs',
    { schema: { tags: ['tools'], summary: 'List active meme sticker packs' } },
    async () => {
      const names = await memeStickerPacksRepo(app.supabase).listActiveNames();
      return { ok: true, data: { packs: names } };
    },
  );
};

export default memeStickerRoutes;
