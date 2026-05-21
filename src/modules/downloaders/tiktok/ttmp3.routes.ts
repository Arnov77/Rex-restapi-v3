import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '../_proxy/proxy.token.js';
import { loadEnv } from '../../../config/env.js';

const Ttmp3Query = z.object({
  url: z.string().url().refine(
    (u) => /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(u),
    { message: 'Must be a valid TikTok URL' },
  ),
});

const Ttmp3Response = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    url: z.string(),
    format: z.string(),
  }),
});

const ttmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'TikTok to MP3',
        description: 'Extract audio from TikTok video as MP3. Returns a streamable proxy URL.',
        querystring: Ttmp3Query,
        response: { 200: Ttmp3Response },
      },
    },
    async (req) => {
      const env = loadEnv();

      const res = await fetch(env.COBALT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: req.query.url }),
      });

      if (!res.ok) throw new Error(`cobalt returned ${res.status}`);
      const json = await res.json();

      if (json.status === 'error') {
        throw new Error(json.error?.code || 'Audio extraction failed');
      }

      if (!json.url) throw new Error('No audio URL returned');

      const filename = json.filename || 'tiktok_audio.mp3';
      const title = filename.replace(/\.\w+$/, '');

      const base = `${req.protocol}://${req.host}`;
      const proxyedUrl = shortProxyUrl(base, json.url, {
        filename,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true as const,
        data: {
          title,
          url: proxyedUrl,
          format: 'mp3',
        },
      };
    },
  );
};

export default ttmp3Routes;
