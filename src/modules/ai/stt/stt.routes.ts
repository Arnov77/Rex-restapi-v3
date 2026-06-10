import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SttQuery, SttResponse } from './stt.schemas.js';
import { transcribeAudio, transcribeFromUrl } from './stt.service.js';
import { BadRequest } from '@shared/errors.js';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — limit Groq Whisper

const sttRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'stt',
    windowSec: 60,
    max: 10,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many transcription requests',
  });

  app.post(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['ai'],
        summary: 'Speech to Text',
        description: 'Transkripsi audio ke teks pakai Groq Whisper. Kirim URL audio via query `?url=...` atau upload file audio via multipart/form-data field `file`. Mendukung mp3, mp4, ogg, wav, webm, m4a. Max 25MB.',
        querystring: SttQuery,
        response: { 200: SttResponse },
      },
    },
    async (req) => {
      const { url, language } = req.query;

      // Kalau ada URL, fetch dari URL
      if (url) {
        const result = await transcribeFromUrl(url, language);
        return { ok: true as const, data: result };
      }

      // Kalau tidak ada URL, coba baca file upload
      const data = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!data) throw BadRequest('Kirim URL audio via ?url= atau upload file audio');

      const buffer = await data.toBuffer();
      if (buffer.length === 0) throw BadRequest('File audio kosong');

      const result = await transcribeAudio(buffer, data.filename || 'audio.mp3', language);
      return { ok: true as const, data: result };
    },
  );
};

export default sttRoutes;
