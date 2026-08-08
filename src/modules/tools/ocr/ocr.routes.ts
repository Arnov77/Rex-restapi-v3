import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { OcrQuery, OcrResponse } from './ocr.schemas.js';
import { ocrFromBuffer, ocrFromUrl } from './ocr.service.js';
import { BadRequest } from '@shared/errors.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const ocrRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily OCR quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'ocr',
    windowSec: 60,
    max: 10,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many OCR requests. Try again in a minute.',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'OCR — Ekstrak teks dari gambar',
        description:
          'toola untuk mengekstrak teks dari gambar secara akurat. ' +
          'Kirim gambar via `?image=<url>` atau upload file multipart/form-data dengan field `file`. ' +
          'Mendukung JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC. Max 20 MB.',
        querystring: OcrQuery,
        response: { 200: OcrResponse },
      },
    },
    async (req) => {
      const { image, lang } = req.query;

      // ── URL via query param ──────────────────────────────────────────────
      if (image) {
        const result = await ocrFromUrl(image, lang);
        return { ok: true as const, data: result };
      }

      // ── File upload (multipart) ──────────────────────────────────────────
      const data = await req.file({ limits: { fileSize: MAX_FILE_SIZE } });
      if (!data) throw BadRequest('Kirim URL gambar via ?image= atau upload file gambar');

      const buffer = await data.toBuffer();
      if (buffer.length === 0) throw BadRequest('File gambar kosong');

      const result = await ocrFromBuffer(buffer, data.mimetype, lang);
      return { ok: true as const, data: result };
    },
  );
};

export default ocrRoutes;