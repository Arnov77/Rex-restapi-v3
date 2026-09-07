import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UpscalerQuery } from './upscaler.schemas.js';
import { upscaleFromUrl, upscaleFromBuffer } from './upscaler.service.js';
import { AppError } from '@shared/errors.js';

const upscalerRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'upscaler',
    windowSec: 60,
    max: 3,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many upscale requests',
  });

  app.post(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['tools'],
        summary: 'Upscale an image using AI.',
        description: 'Upscale an image up to 4x resolution using AI. Supports URL or file upload.',
        querystring: UpscalerQuery,
        response: { 200: z.any(), 400: z.any(), 503: z.any() },
      },
    },
    async (req, reply) => {
      const { image } = req.query as UpscalerQuery;

      let result;
      if (image) {
        result = await upscaleFromUrl(image);
      } else {
        if (!req.isMultipart()) {
          throw new AppError(400, 'UPSCALER_NO_IMAGE', 'Provide ?image= URL or upload a file');
        }
        const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!data) throw new AppError(400, 'UPSCALER_NO_FILE', 'No file uploaded');
        if (!data.mimetype?.startsWith('image/')) {
          throw new AppError(400, 'UPSCALER_INVALID_FILE', 'Uploaded file must be an image');
        }
        const buffer = await data.toBuffer();
        if (buffer.length === 0) throw new AppError(400, 'UPSCALER_EMPTY_FILE', 'Image file is empty');
        result = await upscaleFromBuffer(buffer);
      }

      return reply
        .type(result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', 'inline; filename="upscaled.png"')
        .header('cache-control', 'public, max-age=3600')
        .send(result.buffer);
    },
  );
};

export default upscalerRoutes;
