import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Resolve a short TikTok URL (vt.tiktok.com, vm.tiktok.com) to its canonical URL.
 * Cobalt & tikwm work better with the full URL.
 */
async function resolveShortUrl(url: string): Promise<string> {
  if (!/vm\.tiktok\.com|vt\.tiktok\.com/i.test(url)) return url;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8_000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * Fallback: fetch audio URL directly from tikwm API.
 */
async function fetchAudioViaTikwm(url: string): Promise<{ audioUrl: string; title: string }> {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `url=${encodeURIComponent(url)}&count=12&cursor=0&web=1&hd=1`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`tikwm returned ${res.status}`);
  const json = (await res.json()) as any;

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'tikwm: no data returned');
  }

  const d = json.data;
  // music_info.play is a direct CDN audio URL (not watermarked, not rate-limited)
  const audioUrl = d.music_info?.play || d.music;
  if (!audioUrl) throw new Error('tikwm: no audio URL in response');

  const title = (d.title || 'TikTok Audio').replace(/[\r\n]+/g, ' ').trim();
  return { audioUrl, title };
}

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

      // Resolve short URLs first — cobalt and tikwm both work better with canonical URLs
      const resolvedUrl = await resolveShortUrl(req.query.url);

      const base = `${req.protocol}://${req.host}`;
      const errors: string[] = [];

      // ── Method 1: cobalt ──────────────────────────────────────────
      try {
        const res = await fetch(env.COBALT_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            url: resolvedUrl,
            downloadMode: 'audio',
            audioFormat: 'mp3',
            audioBitrate: '128',
            filenameStyle: 'basic',
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          errors.push(`cobalt ${res.status}: ${body.slice(0, 200)}`);
        } else {
          const json = (await res.json()) as { status?: string; error?: { code?: string }; url?: string; filename?: string };

          if (json.status === 'error') {
            errors.push(`cobalt error: ${json.error?.code || 'unknown'}`);
          } else if (json.url) {
            const filename = json.filename || 'tiktok_audio.mp3';
            const title = filename.replace(/\.\w+$/, '');
            const proxyedUrl = shortProxyUrl(base, json.url, {
              filename,
              contentType: 'audio/mpeg',
            });
            return { ok: true as const, data: { title, url: proxyedUrl, format: 'mp3' } };
          } else {
            errors.push('cobalt: no audio URL returned');
          }
        }
      } catch (err: any) {
        errors.push(`cobalt: ${err.message}`);
      }

      // ── Method 2: tikwm direct audio URL ─────────────────────────
      try {
        req.log.info({ resolvedUrl }, 'cobalt failed, trying tikwm fallback');
        const { audioUrl, title } = await fetchAudioViaTikwm(resolvedUrl);
        const filename = `${title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80) || 'tiktok_audio'}.mp3`;
        const proxyedUrl = shortProxyUrl(base, audioUrl, {
          filename,
          contentType: 'audio/mpeg',
        });
        return { ok: true as const, data: { title, url: proxyedUrl, format: 'mp3' } };
      } catch (err: any) {
        errors.push(`tikwm: ${err.message}`);
      }

      // Both methods failed
      throw new Error(`TikTok audio extraction failed. Tried: ${errors.join('; ')}`);
    },
  );
};

export default ttmp3Routes;