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
        summary: 'Muslim AI — Chat dengan Udin',
        description:
          'Chat santai dengan Udin, AI yang paham seputar Islam tapi ngobrolnya kayak temen, bukan ceramah formal. ' +
          'Session percakapan disimpan selama 24 jam dari pesan terakhir — kirim `?session=` ' +
          'yang sama untuk lanjutkan percakapan, atau kosongkan untuk mulai session baru ' +
          '(session ID baru akan di-return di response, simpan untuk request berikutnya).',
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
