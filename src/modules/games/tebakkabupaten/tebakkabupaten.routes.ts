import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkabupatenResponse } from './tebakkabupaten.schemas.js';
import { getRandomTebakkabupaten } from './tebakkabupaten.service.js';

const tebakkabupatenRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random Indonesian regency/city-guessing question.',
        response: { 200: TebakkabupatenResponse },
      },
    },
    async () => {
      const data = getRandomTebakkabupaten();
      return { ok: true as const, data };
    },
  );
};

export default tebakkabupatenRoutes;