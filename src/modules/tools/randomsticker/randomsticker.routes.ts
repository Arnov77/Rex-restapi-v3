import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomStickerService } from './randomsticker.service.js';
import { randomStickerPacksRepo } from './randomsticker.repo.js';
import { randomStickerQuery } from './randomsticker.schemas.js';

const randomStickerRoutes: FastifyPluginAsyncZod = async (app) => {

  app.get(
    '/',
    {
      schema: {
        tags: ['tools'],
        summary: 'Get a random Indonesian meme sticker. Params: format, quality, pack (optional)',
        querystring: randomStickerQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const result = await randomStickerService.getRandomrandomSticker(app.supabase, req.query, ac.signal);
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
    { schema: { tags: ['tools'], hide: true, summary: 'List active meme sticker packs' } },
    async () => {
      const names = await randomStickerPacksRepo(app.supabase).listActiveNames();
      return { ok: true, data: { packs: names } };
    },
  );
};

export default randomStickerRoutes;
