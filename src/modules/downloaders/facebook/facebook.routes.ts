import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { FacebookQuery, FacebookResponse } from './facebook.schemas.js';
import { downloadFacebook } from './facebook.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const facebookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download Facebook video/post',
        description: 'Returns metadata + proxy URLs for videos and images from Facebook posts and reels.',
        querystring: FacebookQuery,
        response: { 200: FacebookResponse },
      },
    },
    async (req) => {
      const result = await downloadFacebook(req.query.url);

      const base = `${req.protocol}://${req.host}`;
      const media = result.media.map((m, i) => {
        const ext = m.type === 'video' ? 'mp4' : 'jpg';
        const ct = m.type === 'video' ? 'video/mp4' : 'image/jpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `facebook_${i + 1}.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default facebookRoutes;
