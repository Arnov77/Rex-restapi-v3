import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TebakkabupatenResponse } from './tebakkabupaten.schemas.js';
import { getRandomTebakkabupaten } from './tebakkabupaten.service.js';

const tebakkabupatenRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak kabupaten acak',
        description:
          'Mengembalikan satu data kabupaten/kota secara acak, dengan gambar lambang ' +
          'yang sudah di-cache dari Wikipedia (data lokal, tidak ada network call saat runtime).',
        response: { 200: TebakkabupatenResponse },
      },
    },
    async () => {
      const data = getRandomTebakkabupaten();
      return { ok: true as const, data };
    },
  );
};

export default tebakkabupatenRoutes;