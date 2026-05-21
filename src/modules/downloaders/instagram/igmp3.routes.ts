import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '../_proxy/proxy.token.js';
import { loadEnv } from '../../../config/env.js';

const Igmp3Query = z.object({
  url: z.string().url().refine(
    (u) => /instagram\.com|instagr\.am/i.test(u),
    { message: 'Must be a valid Instagram URL' },
  ),
});

const Igmp3Response = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    url: z.string(),
    format: z.string(),
  }),
});

const igmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Instagram to MP3',
        description: 'Extract audio from Instagram reel/video as MP3. Returns a streamable proxy URL.',
        querystring: Igmp3Query,
        response: { 200: Igmp3Response },
      },
    },
    async (req) => {
      const env = loadEnv();

      const res = await fetch(env.COBALT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          url: req.query.url,
          downloadMode: 'audio',
          audioFormat: 'mp3',
          audioBitrate: '128',
          filenameStyle: 'basic',
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        req.log.warn({ status: res.status, body: body.slice(0, 500) }, 'cobalt non-2xx');
        throw new Error(`cobalt returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const json = (await res.json()) as { status?: string; error?: { code?: string }; url?: string; filename?: string };

      if (json.status === 'error') {
        throw new Error(json.error?.code || 'Audio extraction failed');
      }

      if (!json.url) throw new Error('No audio URL returned');

      const filename = json.filename || 'instagram_audio.mp3';
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

export default igmp3Routes;
