import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkataResponse } from './tebakkata.schemas.js';
import { getRandomTebakkata } from './tebakkata.service.js';

const tebakkataRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random word-guessing question.',
        response: { 200: TebakkataResponse },
      },
    },
    async () => {
      const data = getRandomTebakkata();
      return { ok: true as const, data };
    },
  );
};

export default tebakkataRoutes;
