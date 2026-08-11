import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CombineBody, CombineResponse } from './combine.schemas.js';
import { generateCombine } from './combine.service.js';

const combineRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily combine quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'combine',
    windowSec: 60,
    max: 10,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many combine requests',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'Combine multiple images into one with a caption banner.',
        body: CombineBody,
        response: { 200: CombineResponse },
      },
    },
    async (req) => {
      const result = await generateCombine({ body: req.body, signal: undefined });

      return {
        ok: true as const,
        data: {
          image_base64: result.buffer.toString('base64'),
          mime_type: result.mimeType,
        },
      };
    },
  );
};

export default combineRoutes;