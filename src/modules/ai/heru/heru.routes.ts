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
    message: 'Terlalu banyak request, coba lagi dalam 1 menit',
  });

  app.get('/', {
    preHandler: [quota, limit],
    schema: {
      tags: ['ai'],
      summary: 'Heru — AI Chatbot temen ngobrol',
      description:
        'Chat santai sama Heru, AI dengan personality anak tongkrongan — asik, humble, ga kaku. ' +
        'Session disimpan 24 jam dari pesan terakhir. Kosongkan `session` untuk mulai chat baru, ' +
        'kirim session ID yang sama untuk lanjut percakapan.',
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