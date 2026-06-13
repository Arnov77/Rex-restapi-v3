import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '@shared/errors.js';
import { RemoveBgQuery } from './background.schemas.js';
import { backgroundService } from './background.service.js';
import { readMultipartImage, sendImageResult } from './background.shared.js';

const removebgRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily remove background quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'removebg',
    windowSec: 60,
    max: 4,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many remove background requests',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'Remove Background',
        description:
          'Hapus background gambar dan hasilkan background transparan. Kirim URL gambar via query `?image_url=...` atau upload file image via multipart/form-data field `file`. Max 10MB.',
        querystring: RemoveBgQuery,
      },
    },
    async (req, reply) => {
      const { format, image_url } = req.query;
      const image = await readMultipartImage(req);

      if (!image.buffer && !image_url) {
        throw new AppError(400, 'REMOVEBG_NO_IMAGE', 'Upload image field or provide image_url');
      }

      const result = await backgroundService.processBackground({
        buffer: image.buffer,
        filename: image.filename,
        mimetype: image.mimetype,
        imageUrl: image_url,
        format,
        background: 'transparent',
        signal: undefined,
      });

      return sendImageResult(reply, result, 'removebg');
    },
  );
};

export default removebgRoutes;
