import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakbenderaResponse } from './tebakbendera.schemas.js';
import { getRandomTebakbendera } from './tebakbendera.service.js';

const tebakbenderaRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random flag-guessing question.',
        response: { 200: TebakbenderaResponse },
      },
    },
    async () => {
      const data = getRandomTebakbendera();
      return { ok: true as const, data };
    },
  );
};

export default tebakbenderaRoutes;
