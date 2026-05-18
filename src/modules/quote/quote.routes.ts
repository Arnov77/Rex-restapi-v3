import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { quoteService } from './quote.service.js';
import { QuoteQuery } from './quote.schemas.js';

const quoteRoutes: FastifyPluginAsyncZod = async (app) => {
  // Daily quota first (cheap short-circuit), then per-minute rate-limit.
  // Master keys bypass the quota check entirely.
  const quota = app.quota({ message: 'Daily quote quota exceeded' });

  // Quote is lighter than brat (single screenshot, no frame loop), but it
  // still spins up a browser page. Same bucket as brat/screenshot.
  const limit = app.rateLimit({
    prefix: 'quote',
    windowSec: 60,
    max: 30,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many quote requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Render a Twitter-style quote card (PNG/JPEG/WebP)',
        querystring: QuoteQuery,
      },
    },
    async (req, reply) => {
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const before = quoteService.cache.hits;
      const result = await quoteService.generate(req.query, { signal: ac.signal });
      const cacheHit = quoteService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="quote.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default quoteRoutes;
