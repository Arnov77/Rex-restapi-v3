import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkimiaResponse } from './tebakkimia.schemas.js';
import { getRandomTebakkimia } from './tebakkimia.service.js';

const tebakkimiaRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random chemical-element-guessing question.',
        response: { 200: TebakkimiaResponse },
      },
    },
    async () => {
      const data = getRandomTebakkimia();
      return { ok: true as const, data };
    },
  );
};

export default tebakkimiaRoutes;
