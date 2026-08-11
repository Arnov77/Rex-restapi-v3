import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { lqService } from './lq.service.js';
import { LqQuery } from './lq.schemas.js';

const lqRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily LQ quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'lq',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many LQ requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Degrade an image into a low-quality meme aesthetic.',
        querystring: LqQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = lqService.cache.hits;

      const result = await lqService.generate(req.query, {
        signal: ac.signal,
      });

      const cacheHit = lqService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="lq.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default lqRoutes;