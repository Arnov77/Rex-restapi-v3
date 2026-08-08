import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AnimeQuery } from './anime.schemas.js';
import { animeFromBuffer, animeFromUrl, AnimeResult } from './anime.service.js';
import { BadRequest } from '@shared/errors.js';

const animeRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily anime style transfer quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'anime',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many requests. Try again in a minute.',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'Anime Style Transfer',
        description:
          'Ubah foto menjadi style anime',
        querystring: AnimeQuery,
      },
    },
    async (req, reply) => {
      const { image, seed } = req.query;
    
      let result: AnimeResult;
      if (image) {
        result = await animeFromUrl(image, seed);
      } else {
        const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!data) throw BadRequest('Kirim URL gambar via ?image= atau upload file gambar');
        const buf = await data.toBuffer();
        if (!buf.length) throw BadRequest('File gambar kosong');
        result = await animeFromBuffer(buf, seed);
      }
    
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', 'inline; filename="anime.jpg"')
        .header('cache-control', 'no-store')
        .send(result.buffer);
    },
  );
};

export default animeRoutes;
