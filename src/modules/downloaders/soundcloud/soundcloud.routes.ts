import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SoundcloudQuery, SoundcloudResponse } from './soundcloud.schemas.js';
import { downloadSoundcloud } from './soundcloud.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const soundcloudRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'soundcloud',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many SoundCloud download requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['download'],
        summary: 'Download SoundCloud track',
        description: 'Mengembalikan metadata + URL audio (mp3) dari sebuah track SoundCloud. Support URL snd.sc.',
        querystring: SoundcloudQuery,
        response: { 200: SoundcloudResponse },
      },
    },
    async (req) => {
      const result = await downloadSoundcloud(req.query.url);
      const base = `${req.protocol}://${req.host}`;

      const url = shortProxyUrl(base, result.audioUrl, {
        filename: `${result.title}.mp3`,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true as const,
        data: {
          title: result.title,
          author: result.author,
          thumbnail: result.thumbnail,
          duration: result.duration,
          url,
          format: 'mp3' as const,
        },
      };
    },
  );
};

export default soundcloudRoutes;