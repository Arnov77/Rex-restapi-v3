import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Tebakbendera2Response } from './tebakbendera2.schemas.js';
import { getRandomTebakbendera2 } from './tebakbendera2.service.js';

const tebakbendera2Routes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Tebak bendera acak (v2)',
        description: 'Mengembalikan satu soal tebak bendera negara (versi 2, gambar resolusi lebih tinggi) secara acak.',
        response: { 200: Tebakbendera2Response },
      },
    },
    async () => {
      const data = getRandomTebakbendera2();
      return { ok: true as const, data };
    },
  );
};

export default tebakbendera2Routes;
