/**
 * Signed-URL proxy — streams media from a source URL to the client.
 *
 * Token contains: { url, exp, filename?, contentType? }
 * Signed with HMAC-SHA256 using JWT_SECRET. Verified before streaming.
 *
 * This prevents the endpoint from being an open relay while letting
 * bot users download media through our domain (faster, more reliable
 * than random CDN URLs that expire quickly).
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { verifyProxyToken } from './proxy.token.js';
import { loadEnv } from '../../../config/env.js';

const ProxyQuery = z.object({
  t: z.string().min(1, 'Missing token'),
});

const proxyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        hide: true,
        tags: ['download'],
        summary: 'Stream media via signed proxy token',
        querystring: ProxyQuery,
      },
    },
    async (req, reply) => {
      const payload = verifyProxyToken(req.query.t);
      if (!payload) {
        return reply.code(403).send({ ok: false, error: { message: 'Invalid or expired token' } });
      }

      const env = loadEnv();
      const maxBytes = env.DOWNLOAD_MAX_BYTES;

      // Fetch source with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      // Abort on client disconnect
      req.raw.on('close', () => controller.abort());

      try {
        // Build headers per CDN requirements
        const proxyHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        };
        // TikTok CDNs (tiktokcdn-us.com, ibytedtos.com, etc) require
        // Range header to respond properly (media player behavior).
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

        // 206 Partial Content is OK (we sent Range header)
        if (!upstream.ok && upstream.status !== 206) {
          return reply.code(502).send({
            ok: false,
            error: { message: `Upstream returned ${upstream.status}` },
          });
        }

        // Check content-length before streaming
        const clHeader = upstream.headers.get('content-length') || upstream.headers.get('content-range')?.split('/')[1];
        const contentLength = Number(clHeader || 0);
        if (contentLength > maxBytes) {
          return reply.code(413).send({
            ok: false,
            error: { message: `File too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${Math.round(maxBytes / 1024 / 1024)}MB)` },
          });
        }

        // Set response headers
        const ct = payload.contentType || upstream.headers.get('content-type') || 'application/octet-stream';
        reply.header('content-type', ct);
        if (contentLength) reply.header('content-length', String(contentLength));
        if (payload.filename) {
          reply.header('content-disposition', `attachment; filename="${payload.filename}"`);
        }
        reply.header('cache-control', 'private, max-age=3600');

        // Stream body → client (no buffering in RAM)
        if (!upstream.body) {
          return reply.code(204).send();
        }

        const nodeStream = Readable.fromWeb(upstream.body as any);
        return reply.send(nodeStream);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return reply.code(499).send({ ok: false, error: { message: 'Client disconnected or timeout' } });
        }
        req.log.error({ err, url: payload.url }, 'proxy stream failed');
        return reply.code(502).send({ ok: false, error: { message: 'Failed to fetch upstream' } });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
};

export default proxyRoutes;
