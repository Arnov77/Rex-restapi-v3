import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TranslateQuery, TranslateResponse } from './translate.schemas.js';
import { translateText } from './translate.service.js';

const translateRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'translate',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many translate requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['tools'],
        summary: 'Translate teks',
        description: 'Terjemahkan teks ke bahasa apapun menggunakan Groq LLM. Mendukung auto-detect bahasa sumber. Hasilnya lebih natural dibanding translate konvensional karena memahami konteks.',
        querystring: TranslateQuery,
        response: { 200: TranslateResponse },
      },
    },
    async (req) => {
      const { text, to, from } = req.query;
      const result = await translateText(text, to, from);
      return { ok: true as const, data: result };
    },
  );
};

export default translateRoutes;
