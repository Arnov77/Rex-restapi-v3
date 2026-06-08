import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PinterestQuery, PinterestResponse } from './pinterest.schemas.js';
import { downloadPinterest } from './pinterest.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const pinterestRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'pinterest',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many Pinterest download requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['download'],
        summary: 'Download Pinterest image/video',
        description: 'Mengembalikan metadata + URL media dari sebuah Pinterest pin (gambar atau video). Support URL pin.it.',
        querystring: PinterestQuery,
        response: { 200: PinterestResponse },
      },
    },
    async (req) => {
      const result = await downloadPinterest(req.query.url);
      const base = `${req.protocol}://${req.host}`;

      const media = result.media.map((m) => {
        const ext = m.type === 'video' ? 'mp4' : 'jpg';
        const ct = m.type === 'video' ? 'video/mp4' : 'image/jpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `pinterest-${result.id}.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default pinterestRoutes;
