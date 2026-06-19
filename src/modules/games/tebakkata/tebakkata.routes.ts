import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkataResponse } from './tebakkata.schemas.js';
import { getRandomTebakkata } from './tebakkata.service.js';

const tebakkataRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak kata acak',
        description: 'Mengembalikan satu soal tebak kata secara acak.',
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
