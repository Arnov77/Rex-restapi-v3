import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HitamQuery } from './hitam.schemas.js';
import { hitamFromBuffer, hitamFromUrl, HitamResult } from './hitam.service.js';
import { BadRequest } from '@shared/errors.js';

const hitamRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'hitam',
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
        summary: "Change a character's skin tone in an image.",
        querystring: HitamQuery,
      },
    },
    async (req, reply) => {
      const { image, seed } = req.query;
    
      let result: HitamResult;
      if (image) {
        result = await hitamFromUrl(image, seed);
      } else {
        const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!data) throw BadRequest('Kirim URL gambar via ?image= atau upload file gambar');
        const buf = await data.toBuffer();
        if (!buf.length) throw BadRequest('File gambar kosong');
        result = await hitamFromBuffer(buf, seed);
      }
    
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', 'inline; filename="hitam.jpg"')
        .header('cache-control', 'no-store')
        .send(result.buffer);
    },
  );
};

export default hitamRoutes;
