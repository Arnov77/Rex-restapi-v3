import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SusunkataResponse } from './susunkata.schemas.js';
import { getRandomSusunkata } from './susunkata.service.js';

const susunkataRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random word-scramble question.',
        response: { 200: SusunkataResponse },
      },
    },
    async () => {
      const data = getRandomSusunkata();
      return { ok: true as const, data };
    },
  );
};

export default susunkataRoutes;
