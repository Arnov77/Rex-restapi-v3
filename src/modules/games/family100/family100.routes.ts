import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Family100Response } from './family100.schemas.js';
import { getRandomFamily100 } from './family100.service.js';

const family100Routes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random Family Feud-style question.',
        response: { 200: Family100Response },
      },
    },
    async () => {
      const data = getRandomFamily100();
      return { ok: true as const, data };
    },
  );
};

export default family100Routes;
