import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '../_proxy/proxy.token.js';
import { loadEnv } from '../../../config/env.js';

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
      const env = loadEnv();

      const res = await fetch(env.COBALT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: req.query.url, downloadMode: 'audio', audioFormat: 'mp3' }),
      });

      if (!res.ok) throw new Error(`cobalt returned ${res.status}`);
      const json = await res.json();

      if (json.status === 'error') {
        throw new Error(json.error?.code || 'Audio extraction failed');
      }

      if (!json.url) throw new Error('No audio URL returned');

      // Parse title from filename
      const filename = json.filename || 'audio.mp3';
      const title = filename.replace(/\.\w+$/, '').replace(/\s*\([^)]+\)\s*$/, '');
      const parts = title.split(' - ');
      const author = parts.length >= 2 ? parts[parts.length - 1] : '';
      const songTitle = parts.length >= 2 ? parts.slice(0, -1).join(' - ') : title;

      const base = `${req.protocol}://${req.host}`;
      const proxyedUrl = shortProxyUrl(base, json.url, {
        filename: filename,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true as const,
        data: {
          title: songTitle,
          author,
          url: proxyedUrl,
          format: 'mp3',
        },
      };
    },
  );
};

export default ytmp3Routes;
