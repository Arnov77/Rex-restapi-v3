import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HeruQuery, HeruBody, HeruResponse, type HeruInput } from './heru.schemas.js';
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

  const handleChat = async (params: HeruInput, ownerKeyId: string | null, log: any) => {
    const { text, session, ...config } = params;
    const result = await chatWithHeru(app.supabase, text, session, config, ownerKeyId, log);

    return {
      ok: true as const,
      data: {
        reply: result.reply,
        session: result.session,
        expires_at: result.expiresAt,
        history_length: result.historyLength,
      },
    };
  };

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['ai'],
        summary: 'Heru: casual AI chatbot',
        description:
          'Sessions persist for 24 hours. Leave `session` empty to start a new chat, ' +
          'or reuse the same id to continue one. Supports custom persona, tone, and defense presets.',
        querystring: HeruQuery,
        response: { 200: HeruResponse },
      },
    },
    async (req) => {
      const ownerKeyId = req.apiKey?.id ?? null;
      return handleChat(req.query, ownerKeyId, req.log);
    },
  );

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['ai'],
        summary: 'Heru: casual AI chatbot (JSON body)',
        description:
          'Sessions persist for 24 hours. Send text and optional persona configuration in JSON body.',
        body: HeruBody,
        response: { 200: HeruResponse },
      },
    },
    async (req) => {
      const ownerKeyId = req.apiKey?.id ?? null;
      return handleChat(req.body, ownerKeyId, req.log);
    },
  );
};

export default heruRoutes;