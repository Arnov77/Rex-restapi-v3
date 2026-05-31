import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { qcService } from './qc.service.js';
import { QcQuery } from './qc.schemas.js';

const qcRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily QC quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'qc',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many QC requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render a WhatsApp Quoted Chat bubble. Params: text, quoted_name, quoted_text, avatar, time',
        querystring: QcQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = qcService.cache.hits;
      const result = await qcService.generate(req.query, { signal: ac.signal });
      const cacheHit = qcService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="qc.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default qcRoutes;
