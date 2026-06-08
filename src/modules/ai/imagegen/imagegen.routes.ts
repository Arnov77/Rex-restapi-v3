import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ImagegenQuery } from './imagegen.schemas.js';
import { generateImage } from './imagegen.service.js';

const imagegenRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'imagegen',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many image generation requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['ai'],
        summary: 'AI Image Generator',
        description:
          'Generate gambar dari teks menggunakan AI. Mendukung negative prompt auto/custom/none.',
        querystring: ImagegenQuery,
      },
    },
    async (req, reply) => {
      const buffer = await generateImage({
        prompt: req.query.prompt,
        negativeMode: req.query.negative_mode,
        negativePrompt: req.query.negative_prompt,
      });

      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'no-store')
        .send(buffer);
    },
  );
};

export default imagegenRoutes;