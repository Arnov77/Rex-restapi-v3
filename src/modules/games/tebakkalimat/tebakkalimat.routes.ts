import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkalimatResponse } from './tebakkalimat.schemas.js';
import { getRandomTebakkalimat } from './tebakkalimat.service.js';

const tebakkalimatRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random fill-in-the-blank proverb/idiom question.',
        response: { 200: TebakkalimatResponse },
      },
    },
    async () => {
      const data = getRandomTebakkalimat();
      return { ok: true as const, data };
    },
  );
};

export default tebakkalimatRoutes;
