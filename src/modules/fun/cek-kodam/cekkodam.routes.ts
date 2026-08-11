import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CekKodamQuery, CekKodamResponse } from './cekkodam.schemas.js';
import { cekKodam } from './cekkodam.service.js';

const cekkodamRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'cekkodam',
    windowSec: 60,
    max: 60,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many cek khodam requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['fun'],
        summary: 'Check "khodam" by name.',
        description: 'Deterministic per name unless `random=true`.',
        querystring: CekKodamQuery,
        response: {
          200: CekKodamResponse,
        },
      },
    },
    async (req) => {
      return cekKodam(req.query);
    },
  );
};

export default cekkodamRoutes;