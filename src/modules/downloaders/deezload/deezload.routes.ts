import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statSync, createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DeezloadQuery, DeezloadResponse } from './deezload.schemas.js';
import { downloadDeezload } from './deezload.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';
import { cache, inflight, normalizeQuery, trackFile, type DeezloadEntry } from './deezload.store.js';

const DOWNLOAD_DIR = process.env.DEEZLOAD_DOWNLOAD_DIR
  ? resolve(process.env.DEEZLOAD_DOWNLOAD_DIR)
  : resolve(process.cwd(), 'downloads');

console.log(`[deezload] Serving files from: ${DOWNLOAD_DIR}`);

function parseQuery(raw: string): { title: string; artist?: string } {
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx === -1) return { title: raw.trim() };
  const title = raw.slice(0, dashIdx).trim();
  const artist = raw.slice(dashIdx + 3).trim() || undefined;
  return { title, artist };
}

function parseDescription(desc: string | null): { artist: string | null; album: string | null } {
  if (!desc) return { artist: null, album: null };
  const artistMatch = desc.match(/Artist:\s*(.+)/i);
  const albumMatch = desc.match(/Album:\s*(.+)/i);
  return {
    artist: artistMatch?.[1]?.trim() || null,
    album: albumMatch?.[1]?.trim() || null,
  };
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
        summary: 'Download music from DeezLoad (FLAC).',
        description: 'Accepts a song title, or "title - artist" for better matching.',
        querystring: DeezloadQuery,
        response: { 200: DeezloadResponse },
      },
    },
    async (req, reply) => {
      const { title, artist } = parseQuery(req.query.query);
      const base = `${req.protocol}://${req.host}`;

      const key = normalizeQuery(title) + (artist ? `|${artist.toLowerCase()}` : '');
      const hitsBefore = cache.hits;

      let entry = cache.get(key);

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
      const { artist: parsedArtist, album } = parseDescription(entry.description);

      return reply
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send({
          ok: true as const,
          data: {
            title: entry.title,
            artist: parsedArtist,
            album,
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