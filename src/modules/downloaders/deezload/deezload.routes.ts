import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { DeezloadQuery, DeezloadResponse } from './deezload.schemas.js';
import { downloadDeezload } from './deezload.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const deezloadRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'deezload',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many DeezLoad download requests',
  });

  // Main endpoint — download dan return short proxy URL
  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['download'],
        summary: 'Download music from DeezLoad (FLAC)',
        description: 'Download lossless FLAC music using internal DeezLoad Telegram service.',
        querystring: DeezloadQuery,
        response: { 200: DeezloadResponse },
      },
    },
    async (req) => {
      const result = await downloadDeezload(req.query.query);

      const base = `${req.protocol}://${req.host}`;
      const fileId = basename(result.file_path);
      // Proxy fetch ke endpoint Fastify sendiri (domain publik) — bukan ke 127.0.0.1
      const internalUrl = `${base}/api/downloader/deezload/file/${encodeURIComponent(fileId)}`;
      const url = shortProxyUrl(base, internalUrl, {
        filename: result.file_name,
        contentType: 'audio/flac',
      });

      return {
        ok: true as const,
        data: {
          title: result.title,
          description: result.description,
          filename: result.file_name,
          format: 'flac' as const,
          url,
        },
      };
    },
  );

  // File serving endpoint — diakses oleh proxy secara internal
  app.get(
    '/file/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // Validasi: hanya boleh nama file biasa, cegah path traversal
      if (!id || id.includes('/') || id.includes('..') || id.includes('\0')) {
        return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
      }

      // Ambil DOWNLOAD_DIR dari env Python (harus sama)
      const downloadDir = '/root/tele/downloads';
      const filePath = `${downloadDir}/${id}`;

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