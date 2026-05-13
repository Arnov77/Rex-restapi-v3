import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        response: {
          200: z.object({ ok: z.literal(true), uptime: z.number(), version: z.string() }),
        },
      },
    },
    async () => ({ ok: true as const, uptime: process.uptime(), version: '3.0.0' }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe (checks DB)',
        response: {
          200: z.object({ ok: z.literal(true), db: z.literal('up') }),
          503: z.object({ ok: z.literal(false), db: z.literal('down') }),
        },
      },
    },
    async (_req, reply) => {
      const { error } = await app.supabase.from('rex_users').select('id').limit(1);
      if (error) return reply.code(503).send({ ok: false as const, db: 'down' as const });
      return { ok: true as const, db: 'up' as const };
    },
  );
};

export default healthRoutes;
