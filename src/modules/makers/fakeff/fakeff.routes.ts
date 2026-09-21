import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fakeffService } from './fakeff.service.js';
import { FakeFFQuery } from './fakeff.schemas.js';

const fakeffRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily fakeff quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'fakeff',
    windowSec: 60,
    max: 10,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many fakeff requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Generate a fake FF lobby image with a random template and local custom font.',
        querystring: FakeFFQuery,
      },
    },
    async (req, reply) => {
      const result = await fakeffService.generate(req.query);
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="fakeff.${ext}"`)
        .header('cache-control', 'no-store, no-cache, must-revalidate')
        .header('pragma', 'no-cache')
        .header('expires', '0')
        .header('x-template-used', result.templateId)
        .send(result.buffer);
    },
  );
};

export default fakeffRoutes;
