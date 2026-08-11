import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MuslimAiQuery, MuslimAiResponse } from './muslimAi.schemas.js';
import { chatWithUstadz } from './muslimAi.service.js';

const muslimAiRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily Muslim AI quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'muslim-ai',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many requests. Try again in a minute.',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['ai'],
        summary: 'Udin — Islamic-knowledge AI chatbot',
        description:
          'Sessions persist for 24 hours. Send the same `session` id to continue a ' +
          'conversation, or omit it to start a new one — the new id is returned in the response.',
        querystring: MuslimAiQuery,
        response: { 200: MuslimAiResponse },
      },
    },
    async (req) => {
      const { text, session } = req.query;
      const ownerKeyId = req.apiKey?.id ?? null;

      const result = await chatWithUstadz(app.supabase, text, session, ownerKeyId);

      return {
        ok: true as const,
        data: {
          reply: result.reply,
          session: result.session,
          expires_at: result.expiresAt,
          history_length: result.historyLength,
        },
      };
    },
  );
};

export default muslimAiRoutes;
