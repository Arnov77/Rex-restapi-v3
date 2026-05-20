import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { InstagramQuery, InstagramResponse } from './instagram.schemas.js';
import { downloadInstagram } from './instagram.service.js';
import { shortProxyUrl } from '../_proxy/proxy.token.js';

const instagramRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download Instagram post/reel',
        description: 'Returns metadata + proxy URLs for videos and images from Instagram posts, reels, and carousels.',
        querystring: InstagramQuery,
        response: { 200: InstagramResponse },
      },
    },
    async (req) => {
      const result = await downloadInstagram(req.query.url);

      const base = `${req.protocol}://${req.host}`;
      const media = result.media.map((m, i) => {
        const ext = m.type === 'video' ? 'mp4' : 'jpg';
        const ct = m.type === 'video' ? 'video/mp4' : 'image/jpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `instagram_${i + 1}.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default instagramRoutes;
