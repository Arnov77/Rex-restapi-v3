import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SiapakahakuResponse } from './siapakahaku.schemas.js';
import { getRandomSiapakahaku } from './siapakahaku.service.js';

const siapakahakuRoutes: FastifyPluginAsyncZod = async (_app) => {
  _app.get(
    '/random',
    {
      schema: {
        tags: ['games'],
        summary: 'Get a random "who am I" riddle.',
        response: { 200: SiapakahakuResponse },
      },
    },
    async () => {
      const data = getRandomSiapakahaku();
      return { ok: true as const, data };
    },
  );
};

export default siapakahakuRoutes;
