import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { IpLookupQuery, IpLookupResponse } from './iplookup.schemas.js';
import { lookupIp } from './iplookup.service.js';

const iplookupRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'iplookup',
    windowSec: 60,
    max: 30,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many IP lookup requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['tools'],
        summary: 'Look up details for an IP address.',
        querystring: IpLookupQuery,
        response: { 200: IpLookupResponse },
      },
    },
    async (req) => {
      const result = await lookupIp(req.query.ip);
      return { ok: true as const, data: result };
    },
  );
};

export default iplookupRoutes;
