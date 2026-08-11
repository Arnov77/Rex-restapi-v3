import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { smemeService } from './smeme.service.js';
import { SmemeQuery } from './smeme.schemas.js';

const smemeRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily SMEME quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'smeme',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many SMEME requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render a classic top/bottom-text meme.',
        querystring: SmemeQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = smemeService.cache.hits;
      const result = await smemeService.generate(req.query, { signal: ac.signal });
      const cacheHit = smemeService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="smeme.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default smemeRoutes;
