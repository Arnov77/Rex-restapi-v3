import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { iqcService } from './iqc.service.js';
import { IqcQuery } from './iqc.schemas.js';

const iqcRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily IQC quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'iqc',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many IQC requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render an iPhone Quote Chat image. Params: type, text, media',
        querystring: IqcQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = iqcService.cache.hits;
      const result = await iqcService.generate(req.query, { signal: ac.signal });
      const cacheHit = iqcService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="iqc.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default iqcRoutes;