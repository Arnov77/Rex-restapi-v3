import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TwitterQuery, TwitterResponse } from './twitter.schemas.js';
import { downloadTwitter } from './twitter.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const twitterRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download media from a Twitter/X post.',
        querystring: TwitterQuery,
        response: { 200: TwitterResponse },
      },
    },
    async (req) => {
      const result = await downloadTwitter(req.query.url);

      // Replace raw media URLs with signed proxy URLs
      const base = `${req.protocol}://${req.host}`;
      const media = result.media.map((m, i) => {
        const ext = m.type === 'video' ? 'mp4' : m.type === 'gif' ? 'mp4' : 'jpg';
        const ct = m.type === 'video' || m.type === 'gif' ? 'video/mp4' : 'image/jpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `twitter_${i + 1}.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default twitterRoutes;
