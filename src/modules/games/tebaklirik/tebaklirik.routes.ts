import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebaklirikResponse } from './tebaklirik.schemas.js';
import { getRandomTebaklirik } from './tebaklirik.service.js';

const tebaklirikRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak lirik acak',
        description: 'Mengembalikan satu soal tebak lirik lagu secara acak.',
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
