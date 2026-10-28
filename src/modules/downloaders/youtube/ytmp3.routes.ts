import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ytultraGetAudio } from './ytultra.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const Ytmp3Query = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
});

const ytmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Extract audio from a YouTube video as MP3.',
        querystring: Ytmp3Query,
      },
    },
    async (req) => {
      const result = await ytultraGetAudio(req.query.url);

      const base = `${req.protocol}://${req.host}`;
      const proxyUrl = shortProxyUrl(base, result.audioUrl, {
        filename: `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.mp3`,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true,
        data: {
          title: result.title,
          author: result.author,
          url: proxyUrl,
          format: 'mp3',
        },
      };
    },
  );
};

export default ytmp3Routes;
