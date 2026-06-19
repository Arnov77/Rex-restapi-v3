import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakgambarResponse } from './tebakgambar.schemas.js';
import { getRandomTebakgambar } from './tebakgambar.service.js';

const tebakgambarRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak gambar acak',
        description: 'Mengembalikan satu soal tebak gambar secara acak.',
        response: { 200: TebakgambarResponse },
      },
    },
    async () => {
      const data = getRandomTebakgambar();
      return { ok: true as const, data };
    },
  );
};

export default tebakgambarRoutes;
