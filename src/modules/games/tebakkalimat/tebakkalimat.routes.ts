import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkalimatResponse } from './tebakkalimat.schemas.js';
import { getRandomTebakkalimat } from './tebakkalimat.service.js';

const tebakkalimatRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak kalimat acak',
        description: 'Mengembalikan satu soal tebak kalimat (peribahasa/idiom rumpang) secara acak.',
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
