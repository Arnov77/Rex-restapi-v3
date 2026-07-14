import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { DeezloadQuery, DeezloadResponse } from './deezload.schemas.js';
import { downloadDeezload } from './deezload.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';
import { cache, inflight, normalizeQuery, trackFile, type DeezloadEntry } from './deezload.store.js';

const DOWNLOAD_DIR = process.env.DEEZLOAD_DOWNLOAD_DIR ?? '/root/tele/downloads';

function parseQuery(raw: string): { title: string; artist?: string } {
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx === -1) return { title: raw.trim() };
  const title = raw.slice(0, dashIdx).trim();
  const artist = raw.slice(dashIdx + 3).trim() || undefined;
  return { title, artist };
}

const deezloadRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'deezload',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many DeezLoad download requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['download'],
        summary: 'Download music from DeezLoad (FLAC)',
        description: 'Download lossless FLAC music using internal DeezLoad Telegram service. Format query: "Judul Lagu" atau "Judul Lagu - Artist".',
        querystring: DeezloadQuery,
        response: { 200: DeezloadResponse },
      },
    },
    async (req, reply) => {
      const { title, artist } = parseQuery(req.query.query);
      const base = `${req.protocol}://${req.host}`;

      // Cache key include artist supaya "negoro angin" dan "negoro angin - denny caknan" tidak clash
      const key = normalizeQuery(title) + (artist ? `|${artist.toLowerCase()}` : '');
      const hitsBefore = cache.hits;

      // 1. Cache hit
      let entry = cache.get(key);

      // 2. Miss — download dengan dedup inflight
      if (!entry) {
        let promise = inflight.get(key);
        if (!promise) {
          promise = downloadDeezload(title, artist)
            .then((result): DeezloadEntry => {
              const e: DeezloadEntry = {
                filePath: result.file_path,
                fileName: result.file_name,
                title: result.title,
                description: result.description,
                expiresAt: Date.now() + 60 * 60 * 1000,
              };
              cache.set(key, e);
              trackFile(result.file_path);
              return e;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, promise);
        }
        entry = await promise;
      }

      const cacheHit = cache.hits > hitsBefore;
      const fileId = basename(entry.filePath);
      const internalUrl = `${base}/api/downloader/deezload/file/${encodeURIComponent(fileId)}`;
      const url = shortProxyUrl(base, internalUrl, {
        filename: entry.fileName,
        contentType: 'audio/flac',
      });

      return reply
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send({
          ok: true as const,
          data: {
            title: entry.title,
            description: entry.description,
            filename: entry.fileName,
            format: 'flac' as const,
            url,
          },
        });
    },
  );

  app.get(
    '/file/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (!id || id.includes('/') || id.includes('..') || id.includes('\0')) {
        return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
      }

      const filePath = `${DOWNLOAD_DIR}/${id}`;

      try {
        const stat = statSync(filePath);
        reply
          .type('audio/flac')
          .header('content-length', String(stat.size))
          .header('content-disposition', `inline; filename="${id}"`)
          .header('cache-control', 'private, max-age=3600');
        return reply.send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({ ok: false, error: { message: 'File expired or not found' } });
      }
    },
  );
};

export default deezloadRoutes;