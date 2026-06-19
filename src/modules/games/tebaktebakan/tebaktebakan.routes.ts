import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebaktebakanResponse } from './tebaktebakan.schemas.js';
import { getRandomTebaktebakan } from './tebaktebakan.service.js';

const tebaktebakanRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak-tebakan acak',
        description: 'Mengembalikan satu soal tebak-tebakan lucu secara acak.',
        response: { 200: TebaktebakanResponse },
      },
    },
    async () => {
      const data = getRandomTebaktebakan();
      return { ok: true as const, data };
    },
  );
};

export default tebaktebakanRoutes;
