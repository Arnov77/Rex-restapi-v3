import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebaklogoResponse } from './tebaklogo.schemas.js';
import { getRandomTebaklogo } from './tebaklogo.service.js';

const tebaklogoRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random picture-guessing question.',
        response: { 200: TebaklogoResponse },
      },
    },
    async () => {
      const data = getRandomTebaklogo();
      return { ok: true as const, data };
    },
  );
};

export default tebaklogoRoutes;
