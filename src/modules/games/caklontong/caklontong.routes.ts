import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CaklontongResponse } from './caklontong.schemas.js';
import { getRandomCaklontong } from './caklontong.service.js';

const caklontongRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Cak lontong acak',
        description: 'Mengembalikan satu soal cak lontong (tebak-tebakan logika) secara acak.',
        response: { 200: CaklontongResponse },
      },
    },
    async () => {
      const data = getRandomCaklontong();
      return { ok: true as const, data };
    },
  );
};

export default caklontongRoutes;
