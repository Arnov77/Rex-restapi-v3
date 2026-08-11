import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';
import { AppError } from '@shared/errors.js';
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

const COBALT_TIMEOUT_MS = 20_000;

/**
 * Map a cobalt error code to a client-facing AppError.
 *
 * cobalt 4xx / `status:"error"` responses are *expected* operational
 * conditions (private/removed posts, photo-only posts with no audio, rate
 * limits, or Instagram blocking the cobalt instance). Surfacing them as a
 * clean AppError keeps them out of the "unhandled error" 500 path and gives
 * the caller an actionable message.
 */
function cobaltError(code: string | undefined, status: number): AppError {
  switch (code) {
    case 'error.api.fetch.empty':
    case 'error.api.fetch.fail':
    case 'error.api.fetch.critical':
      return new AppError(
        502,
        'AUDIO_EXTRACTION_FAILED',
        'Instagram returned no media. The post may be private, removed, or photo-only ' +
          '(no audio), or the cobalt instance is being blocked by Instagram. Try another ' +
          'link, or point COBALT_API_URL at a self-hosted instance.',
      );
    case 'error.api.rate_exceeded':
    case 'error.api.fetch.rate':
      return new AppError(
        429,
        'DOWNLOADER_RATE_LIMITED',
        'The downloader is rate-limited right now. Please try again shortly.',
      );
    case 'error.api.content.too_long':
      return new AppError(422, 'CONTENT_TOO_LONG', 'That Instagram video is too long to extract audio from.');
    case 'error.api.link.unsupported':
    case 'error.api.link.invalid':
      return new AppError(400, 'UNSUPPORTED_LINK', 'That Instagram link is not supported for audio extraction.');
    default:
      return new AppError(
        502,
        'AUDIO_EXTRACTION_FAILED',
        code ? `Audio extraction failed (${code}).` : `Audio extraction failed (cobalt ${status}).`,
      );
  }
}

const igmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Extract audio from an Instagram reel or video as MP3.',
        querystring: Igmp3Query,
        response: { 200: Igmp3Response },
      },
    },
    async (req) => {
      const env = loadEnv();

      // Bound the upstream call so a hung cobalt request can't pin the worker.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COBALT_TIMEOUT_MS);
      const onClose = () => controller.abort();
      req.raw.on('close', onClose);

      let res: Response;
      try {
        res = await fetch(env.COBALT_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            url: req.query.url,
            downloadMode: 'audio',
            audioFormat: 'mp3',
            audioBitrate: '128',
            filenameStyle: 'basic',
          }),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          throw new AppError(504, 'UPSTREAM_TIMEOUT', 'Audio extraction timed out. Please try again.');
        }
        req.log.warn({ err }, 'cobalt request failed');
        throw new AppError(502, 'UPSTREAM_UNREACHABLE', 'Could not reach the audio downloader service.');
      } finally {
        clearTimeout(timeout);
        req.raw.off('close', onClose);
      }

      const rawBody = await res.text().catch(() => '');
      let json: { status?: string; error?: { code?: string }; url?: string; filename?: string } = {};
      try {
        json = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        // Non-JSON body (e.g. an HTML error page from a proxy) — handled below.
      }

      if (!res.ok || json.status === 'error') {
        const code = json.error?.code;
        req.log.warn({ status: res.status, code, body: rawBody.slice(0, 300) }, 'cobalt audio extraction failed');
        throw cobaltError(code, res.status);
      }

      // Audio success: cobalt returns tunnel/redirect/stream with a direct URL.
      const mediaUrl = typeof json.url === 'string' ? json.url : undefined;
      if (!mediaUrl) {
        req.log.warn({ status: json.status, body: rawBody.slice(0, 300) }, 'cobalt returned no audio url');
        throw new AppError(
          502,
          'AUDIO_EXTRACTION_FAILED',
          'The downloader did not return an audio file. Please try again.',
        );
      }

      const filename = (typeof json.filename === 'string' && json.filename) || 'instagram_audio.mp3';
      const title = filename.replace(/\.\w+$/, '');

      const base = `${req.protocol}://${req.host}`;
      const proxyedUrl = shortProxyUrl(base, mediaUrl, {
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
