import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkimiaResponse } from './tebakkimia.schemas.js';
import { getRandomTebakkimia } from './tebakkimia.service.js';

const tebakkimiaRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak kimia acak',
        description: 'Mengembalikan satu soal tebak unsur kimia secara acak.',
        response: { 200: TebakkimiaResponse },
      },
    },
    async () => {
      const data = getRandomTebakkimia();
      return { ok: true as const, data };
    },
  );
};

export default tebakkimiaRoutes;
