import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { NsfwQuery, NsfwResponse } from './nsfw.schemas.js';
import { detectNsfwFromUrl, detectNsfwFromBuffer } from './nsfw.service.js';
import { BadRequest } from '@shared/errors.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const nsfwRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily NSFW detection quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'nsfw',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many requests. Try again in a minute.',
  });

  app.post('/', {
    preHandler: [quota, limit],
    schema: {
      tags: ['tools'],
      summary: 'Detect unsafe (NSFW) content in an image.',
      querystring: NsfwQuery,
      response: { 200: NsfwResponse },
    },
  }, async (req) => {
    const { image } = req.query;

    if (image) {
      const result = await detectNsfwFromUrl(image);
      return { ok: true as const, data: result };
    }

    const data = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
    if (!data) throw BadRequest('Kirim URL via ?image= atau upload file gambar');

    const buffer = await data.toBuffer();
    const result = await detectNsfwFromBuffer(buffer, data.mimetype);
    return { ok: true as const, data: result };
  });
};

export default nsfwRoutes;