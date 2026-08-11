import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HeruQuery, HeruResponse } from './heru.schemas.js';
import { chatWithHeru } from './heru.service.js';

const heruRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily Heru quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'heru',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many requests. Try again in a minute.',
  });

  app.get('/', {
    preHandler: [quota, limit],
    schema: {
      tags: ['ai'],
      summary: 'Heru — casual AI chatbot',
      description:
        'Sessions persist for 24 hours. Leave `session` empty to start a new chat, ' +
        'or reuse the same id to continue one.',
      querystring: HeruQuery,
      response: { 200: HeruResponse },
    },
  }, async (req) => {
    const { text, session } = req.query;
    const ownerKeyId = req.apiKey?.id ?? null;

    const result = await chatWithHeru(app.supabase, text, session, ownerKeyId);

    return {
      ok: true as const,
      data: {
        reply: result.reply,
        session: result.session,
        expires_at: result.expiresAt,
        history_length: result.historyLength,
      },
    };
  });
};

export default heruRoutes;