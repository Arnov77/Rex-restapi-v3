import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { bratService } from './brat.service.js';
import { BratQuery } from './brat.schemas.js';

const bratRoutes: FastifyPluginAsyncZod = async (app) => {
  // Daily quota first (cheap short-circuit), then per-minute rate-limit.
  // Master keys bypass the quota check entirely.
  const quota = app.quota({ message: 'Daily brat quota exceeded' });

  // Brat is heavier than screenshot when format=gif (multiple frames + GIF
  // encode). Same per-key/IP bucket as screenshot keeps the API surface
  // predictable for clients juggling both endpoints.
  const limit = app.rateLimit({
    prefix: 'brat',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many brat requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render a brat-style caption image.',
        querystring: BratQuery,
        // No `response` schema: fastify-type-provider-zod expects Zod here,
        // and binary image bytes don't fit a Zod shape. Swagger still lists
        // the endpoint correctly without it.
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = bratService.cache.hits;
      const result = await bratService.generate(req.query, { signal: ac.signal });
      const cacheHit = bratService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="brat.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default bratRoutes;
