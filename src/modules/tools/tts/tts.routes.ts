import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { TtsQuery, TtsResponse } from './tts.schemas.js';
import { generateTts, VOICES } from './tts.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const TTS_TEMP_DIR = join(tmpdir(), 'rexapi-tts');

function getTtsTempDir() {
  if (!existsSync(TTS_TEMP_DIR)) mkdirSync(TTS_TEMP_DIR, { recursive: true });
  return TTS_TEMP_DIR;
}

function createTtsFile(buffer: Buffer) {
  const id = `${randomBytes(16).toString('hex')}.mp3`;
  const filePath = join(getTtsTempDir(), id);

  writeFileSync(filePath, buffer);

  // auto cleanup setelah 1 jam
  setTimeout(() => {
    import('node:fs').then(({ unlink }) => {
      unlink(filePath, () => {});
    }).catch(() => {});
  }, 60 * 60 * 1000).unref();

  return { id, filePath };
}

const ttsRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'tts',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many TTS requests',
  });

  // GET /api/tts/voices — daftar voice yang tersedia
  app.get(
    '/voices',
    {
      schema: {
        tags: ['tools'],
        hide: true,
        summary: 'Daftar voice TTS',
        description: 'Mengembalikan daftar voice yang tersedia untuk endpoint TTS.',
        response: {
          200: z.object({
            ok: z.literal(true),
            data: z.array(z.object({ value: z.string(), label: z.string() })),
          }),
        },
      },
    },
    async () => ({ ok: true as const, data: [...VOICES] }),
  );

  // GET /api/tts
  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['tools'],
        summary: 'Text to Speech',
        description: 'Ubah teks menjadi audio.',
        querystring: TtsQuery,
        response: {
          200: TtsResponse,
        },
      },
    },
    async (req, reply) => {
      const { text, voice, rate, pitch } = req.query;

      const buffer = await generateTts(text, voice, rate, pitch);

      // Mode baru: return JSON berisi proxy URL
      const { id } = createTtsFile(buffer);

      const base = `${req.protocol}://${req.host}`;

      const internalUrl = `${base}/api/tts/file/${id}`;

      const proxyUrl = shortProxyUrl(base, internalUrl, {
        filename: 'tts.mp3',
        contentType: 'audio/mpeg',
      });

      return {
        ok: true as const,
        data: {
          text,
          voice,
          url: proxyUrl,
          format: 'mp3' as const,
        },
      };
    },
  );

  // Endpoint hidden buat stream file MP3 dari temp
  app.get(
    '/file/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (!/^[a-f0-9]+\.mp3$/.test(id)) {
        return reply.code(400).send({
          ok: false,
          error: { message: 'Invalid file ID' },
        });
      }

      const filePath = join(getTtsTempDir(), id);

      try {
        const stat = statSync(filePath);

        return reply
          .type('audio/mpeg')
          .header('content-length', String(stat.size))
          .header('content-disposition', `inline; filename="${id}"`)
          .header('cache-control', 'private, max-age=3600')
          .send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({
          ok: false,
          error: { message: 'File expired or not found' },
        });
      }
    },
  );
};

export default ttsRoutes;