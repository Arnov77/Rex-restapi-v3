import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { YoutubeQuery, YoutubeResponse } from './youtube.schemas.js';
import { downloadYoutube } from './youtube.service.js';
import { shortProxyUrl } from '../_proxy/proxy.token.js';

const youtubeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download YouTube video/audio',
        description: 'Returns metadata + proxy URLs for video and audio streams from YouTube videos, shorts, and live recordings.',
        querystring: YoutubeQuery,
        response: { 200: YoutubeResponse },
      },
    },
    async (req) => {
      const result = await downloadYoutube(req.query.url);

      const base = `${req.protocol}://${req.host}`;
      const media = result.media.map((m, i) => {
        const ext = m.type === 'video' ? 'mp4' : 'mp3';
        const ct = m.type === 'video' ? 'video/mp4' : 'audio/mpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `youtube_${m.type}_${i + 1}.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default youtubeRoutes;
