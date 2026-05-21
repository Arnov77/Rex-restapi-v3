import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '../_proxy/proxy.token.js';
import { ytdlpGetAudio } from './ytdlp.js';

const Ytmp3Query = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
});

const Ytmp3Response = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    author: z.string(),
    url: z.string(),
    format: z.string(),
  }),
});

const ytmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'YouTube to MP3',
        description: 'Extract audio from YouTube video as MP3. Returns a streamable proxy URL.',
        querystring: Ytmp3Query,
        response: { 200: Ytmp3Response },
      },
    },
    async (req) => {
      const result = await ytdlpGetAudio(req.query.url);
      if (!result.url) throw new Error('Failed to extract audio');

      const base = `${req.protocol}://${req.host}`;
      const proxyedUrl = shortProxyUrl(base, result.url, {
        filename: `${result.title}.mp3`,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true as const,
        data: {
          title: result.title,
          author: result.author,
          url: proxyedUrl,
          format: 'mp3',
        },
      };
    },
  );
};

export default ytmp3Routes;
