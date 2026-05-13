import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { bratService } from './brat.service.js';
import { BratQuery } from './brat.schemas.js';

const bratRoutes: FastifyPluginAsyncZod = async (app) => {
  // Brat is heavier than screenshot when format=gif (multiple frames + GIF
  // encode). Same per-key/IP bucket as screenshot keeps the API surface
  // predictable for clients juggling both endpoints.
  const limit = app.rateLimit({
    prefix: 'brat',
    windowSec: 60,
    max: 30,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many brat requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['brat'],
        summary: 'Render a brat-style caption (PNG/JPEG/GIF)',
        querystring: BratQuery,
        response: {
          200: {
            description: 'Image bytes',
            content: {
              'image/png': { schema: { type: 'string', format: 'binary' } },
              'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              'image/gif': { schema: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await bratService.generate(req.query);
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="brat.${ext}"`)
        .send(result.buffer);
    },
  );
};

export default bratRoutes;
