/**
 * Short URL proxy route — GET /p/:id
 *
 * Resolves a short ID to the stored signed proxy token, verifies it,
 * then streams the upstream media to the client. Reuses the same
 * streaming logic as /api/download/proxy but with a much shorter URL.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { get as getShortToken } from './short-store.js';
import { verifyProxyToken } from './proxy.token.js';
import { loadEnv } from '../../../config/env.js';

const ShortParams = z.object({
  id: z.string().min(1),
});

const shortRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:id',
    {
      schema: {
        hide: true,
        tags: ['download'],
        summary: 'Stream media via short proxy URL',
        params: ShortParams,
      },
    },
    async (req, reply) => {
      // 1. Resolve short ID → token
      const token = getShortToken(req.params.id);
      if (!token) {
        return reply.code(404).send({ ok: false, error: { message: 'Link expired or not found' } });
      }

      // 2. Verify token signature + expiry
      const payload = verifyProxyToken(token);
      if (!payload) {
        return reply.code(403).send({ ok: false, error: { message: 'Invalid or expired token' } });
      }

      // 3. Stream from upstream (same logic as proxy.routes.ts)
      const env = loadEnv();
      const maxBytes = env.DOWNLOAD_MAX_BYTES;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      req.raw.on('close', () => controller.abort());

      try {
        const proxyHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        };

        const isTiktokCdn = (h: string) => /tiktok|musical\.ly|byteoversea|ibytedtos|bytecdn|byte-?d/i.test(h);
        try {
          const srcUrl = new URL(payload.url);
          const h = srcUrl.hostname;
          if (h.includes('tikwm.com')) {
            proxyHeaders['Referer'] = 'https://www.tikwm.com/';
          } else if (isTiktokCdn(h)) {
            proxyHeaders['Referer'] = 'https://www.tiktok.com/';
            proxyHeaders['Range'] = 'bytes=0-';
          } else if (h.includes('twimg.com') || h.includes('twitter') || h.includes('x.com')) {
            proxyHeaders['Referer'] = 'https://x.com/';
          } else {
            proxyHeaders['Referer'] = srcUrl.origin + '/';
          }
        } catch {
          proxyHeaders['Referer'] = 'https://www.google.com/';
        }

        const upstream = await fetch(payload.url, {
          signal: controller.signal,
          headers: proxyHeaders,
          redirect: 'follow',
        });

        if (!upstream.ok && upstream.status !== 206) {
          return reply.code(502).send({
            ok: false,
            error: { message: `Upstream returned ${upstream.status}` },
          });
        }

        const clHeader = upstream.headers.get('content-length') || upstream.headers.get('content-range')?.split('/')[1];
        const contentLength = Number(clHeader || 0);
        if (contentLength > maxBytes) {
          return reply.code(413).send({
            ok: false,
            error: { message: `File too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${Math.round(maxBytes / 1024 / 1024)}MB)` },
          });
        }

        const ct = payload.contentType || upstream.headers.get('content-type') || 'application/octet-stream';
        reply.header('content-type', ct);
        if (contentLength) reply.header('content-length', String(contentLength));
        if (payload.filename) {
          reply.header('content-disposition', `attachment; filename="${payload.filename}"`);
        }
        reply.header('cache-control', 'private, max-age=3600');

        if (!upstream.body) {
          return reply.code(204).send();
        }

        const nodeStream = Readable.fromWeb(upstream.body as any);
        return reply.send(nodeStream);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return reply.code(499).send({ ok: false, error: { message: 'Client disconnected or timeout' } });
        }
        req.log.error({ err, url: payload.url }, 'short proxy stream failed');
        return reply.code(502).send({ ok: false, error: { message: 'Failed to fetch upstream' } });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
};

export default shortRoutes;
