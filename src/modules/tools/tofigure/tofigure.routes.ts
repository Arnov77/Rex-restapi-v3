import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TofigureQuery } from './tofigure.schemas.js';
import { tofigureFromBuffer, tofigureFromUrl, TofigureResult } from './tofigure.service.js';
import { BadRequest } from '@shared/errors.js';

const tofigureRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily to figure quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'tofigure',
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
        summary: 'Convert a photo to figure style.',
        querystring: TofigureQuery,
      },
    },
    async (req, reply) => {
      const { image, seed } = req.query;
    
      let result: TofigureResult;
      if (image) {
        result = await tofigureFromUrl(image, seed);
      } else {
        const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
        if (!data) throw BadRequest('Kirim URL gambar via ?image= atau upload file gambar');
        const buf = await data.toBuffer();
        if (!buf.length) throw BadRequest('File gambar kosong');
        result = await tofigureFromBuffer(buf, seed);
      }
    
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', 'inline; filename="tofigure.jpg"')
        .header('cache-control', 'no-store')
        .send(result.buffer);
    },
  );
};

export default tofigureRoutes;
