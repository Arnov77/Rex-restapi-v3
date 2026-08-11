import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AsahotakResponse } from './asahotak.schemas.js';
import { getRandomAsahotak } from './asahotak.service.js';

const asahotakRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random brain-teaser question.',
        response: { 200: AsahotakResponse },
      },
    },
    async () => {
      const data = getRandomAsahotak();
      return { ok: true as const, data };
    },
  );
};

export default asahotakRoutes;
