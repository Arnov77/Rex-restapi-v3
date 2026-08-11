import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebaklirikResponse } from './tebaklirik.schemas.js';
import { getRandomTebaklirik } from './tebaklirik.service.js';

const tebaklirikRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random song-lyric-guessing question.',
        response: { 200: TebaklirikResponse },
      },
    },
    async () => {
      const data = getRandomTebaklirik();
      return { ok: true as const, data };
    },
  );
};

export default tebaklirikRoutes;
