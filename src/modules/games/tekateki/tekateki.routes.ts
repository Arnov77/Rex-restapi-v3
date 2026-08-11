import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TekatekiResponse } from './tekateki.schemas.js';
import { getRandomTekateki } from './tekateki.service.js';

const tekatekiRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random puzzle question.',
        response: { 200: TekatekiResponse },
      },
    },
    async () => {
      const data = getRandomTekateki();
      return { ok: true as const, data };
    },
  );
};

export default tekatekiRoutes;
