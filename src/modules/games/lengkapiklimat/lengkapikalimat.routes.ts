import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { LengkapikalimatResponse } from './lengkapikalimat.schemas.js';
import { getRandomLengkapikalimat } from './lengkapikalimat.service.js';

const lengkapikalimatRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random brain-teaser question.',
        response: { 200: LengkapikalimatResponse },
      },
    },
    async () => {
      const data = getRandomLengkapikalimat();
      return { ok: true as const, data };
    },
  );
};

export default lengkapikalimatRoutes;
