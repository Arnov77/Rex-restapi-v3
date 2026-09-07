import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { smemeService } from './smeme.service.js';
import { SmemeQuery } from './smeme.schemas.js';
import { AppError } from '@shared/errors.js';

const smemeRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily SMEME quota exceeded' });
  const limit = app.rateLimit({
    prefix: 'smeme',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many SMEME requests',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render a classic top/bottom-text meme.',
        description: 'Supports image, GIF, and video (max 10s). Upload file atau gunakan ?url=.',
        querystring: SmemeQuery,
        response: { 200: z.any() },
      },
    },
    async (req, reply) => {
      const query = req.query as SmemeQuery;
      let inputBuffer: Buffer | undefined;
      let inputMime: string | undefined;

      // Handle file upload — baca buffer dulu sebelum setup abort
      if (req.isMultipart()) {
        const data = await req.file({ limits: { fileSize: 50 * 1024 * 1024 } });
        if (data) {
          inputMime = data.mimetype;
          inputBuffer = await data.toBuffer();
          if (!inputBuffer || inputBuffer.length === 0) {
            throw new AppError(400, 'SMEME_EMPTY_FILE', 'Uploaded file is empty');
          }
        }
      }

      if (!inputBuffer && !query.url) {
        throw new AppError(400, 'SMEME_NO_INPUT', 'Upload a file or provide ?url=');
      }

      // Untuk video/GIF tidak pakai abort signal karena ffmpeg perlu waktu
      const isVideoOrGif = inputMime
        ? (inputMime.includes('gif') || inputMime.includes('video') || inputMime.includes('mp4') || inputMime.includes('webm'))
        : false;

      const ac = new AbortController();
      if (!isVideoOrGif) {
        req.raw.once('close', () => ac.abort());
      }

      const before = smemeService.cache.hits;
      const result = await smemeService.generate(query, {
        signal: isVideoOrGif ? undefined : ac.signal,
        inputBuffer,
        inputMime,
      });
      const cacheHit = smemeService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="smeme.${ext}"`)
        .header('cache-control', result.format === 'jpeg' ? 'public, max-age=1800' : 'no-store')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default smemeRoutes;
