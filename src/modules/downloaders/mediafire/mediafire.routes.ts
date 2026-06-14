import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MediafireQuery, MediafireResponse } from './mediafire.schemas.js';
import { downloadMediafire } from './mediafire.service.js';

const mediafireRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download file dari MediaFire',
        description: 'Mengekstrak direct download link dari URL MediaFire tanpa perlu login.',
        querystring: MediafireQuery,
        response: { 200: MediafireResponse },
      },
    },
    async (req) => {
      const data = await downloadMediafire(req.query.url);
      return { ok: true as const, data };
    },
  );
};

export default mediafireRoutes;
