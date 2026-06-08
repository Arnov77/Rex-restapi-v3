import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { QrQuery } from './qr.schemas.js';
import { generateQr } from './qr.service.js';

const qrRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'qr',
    windowSec: 60,
    max: 30,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many QR code requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['tool'],
        summary: 'Generate QR code',
        description: 'Generate QR code sebagai PNG atau SVG. Parameter dikirim via query string.',
        querystring: QrQuery,
      },
    },
    async (req, reply) => {
      const { data, mime } = await generateQr(req.query);
      return reply
        .header('content-type', mime)
        .header('cache-control', 'public, max-age=86400')
        .send(data);
    },
  );
};

export default qrRoutes;
