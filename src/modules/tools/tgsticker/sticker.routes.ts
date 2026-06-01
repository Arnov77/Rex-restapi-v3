import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { stickerService } from './sticker.service.js';
import { StickerSingleQuery, StickerPackQuery } from './sticker.schemas.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

async function resolveAuthor(req: FastifyRequest): Promise<string> {
  const domain = process.env.APP_DOMAIN ?? 'rex-api.xyz';

  // Kalau ada user dari JWT → pakai username
  if (req.user?.username) {
    return `@${req.user.username} • ${domain}`;
  }

  // Kalau ada apiKey tapi tidak ada user → lookup user by apiKeyId
  if (req.apiKey?.id) {
    try {
      // Query Supabase langsung karena usersRepo tidak punya findByApiKeyId
      const { data } = await (req.server as any).supabase
        .from('users')
        .select('username')
        .eq('api_key_id', req.apiKey.id)
        .maybeSingle();
      if (data?.username) return `@${data.username} • ${domain}`;
    } catch {
      // fallthrough
    }
  }

  return `Rex Api • ${domain}`;
}

const stickerRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily sticker quota exceeded' });
  const limit = app.rateLimit({
    prefix: 'sticker',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many sticker requests',
  });

  // ── Single sticker ──────────────────────────────────────────────────────────
  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Fetch & convert a single Telegram sticker. Params: input, format, quality',
        querystring: StickerSingleQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const result = await stickerService.generateSingle(req.query, { signal: ac.signal });
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="sticker.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-animated', result.isAnimated ? '1' : '0')
        .send(result.buffer);
    },
  );

  // ── Pack ────────────────────────────────────────────────────────────────────
  app.get(
    '/pack',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Fetch & convert a Telegram sticker pack. Returns JSON with short proxy URL. Params: input, format, image_format, quality',
        querystring: StickerPackQuery,
      },
    },
    async (req) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const author = await resolveAuthor(req as any);
      const result = await stickerService.generatePack(req.query, author, { signal: ac.signal });

      const base        = `${req.protocol}://${req.host}`;
      const fileId      = basename(result.filePath);
      const internalUrl = `${base}/api/maker/sticker/pack/file/${fileId}`;

      const url = shortProxyUrl(base, internalUrl, {
        filename:    result.filename,
        contentType: result.mimeType,
      });

      return {
        ok: true,
        data: {
          filename: result.filename,
          format:   req.query.format,
          url,
        },
      };
    },
  );

  // ── Pack file serving ───────────────────────────────────────────────────────
  app.get(
    '/pack/file/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!/^[a-zA-Z0-9_-]+\.(zip|wastickers)$/.test(id)) {
        return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
      }

      const filePath = stickerService.lookupFile(id);
      if (!filePath) {
        return reply.code(404).send({ ok: false, error: { message: 'File expired or not found' } });
      }

      try {
        const stat = statSync(filePath);
        return reply
          .type('application/zip')
          .header('content-length', String(stat.size))
          .header('content-disposition', `attachment; filename="${id}"`)
          .header('cache-control', 'private, max-age=3600')
          .send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({ ok: false, error: { message: 'File expired or not found' } });
      }
    },
  );
};

export default stickerRoutes;