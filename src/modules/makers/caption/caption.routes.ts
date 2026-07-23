import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '@shared/errors.js';
import { CaptionBody } from './caption.schemas.js';
import { generateCaption, MAX_IMAGE_BYTES } from './caption.service.js';

const captionRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily caption quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'caption',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many caption requests',
  });

  app.post(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Overlay caption text on an image',
        description:
          'Render `caption_text` di atas gambar dengan gaya teks putih bergaris tepi hitam (bisa diatur). Kirim gambar via SALAH SATU: multipart/form-data field `file`, `image_url`, atau `image_base64` di JSON body. Max 10MB.',
        body: CaptionBody,
        response: {
          200: z.object({
            ok: z.literal(true),
            data: z.object({
              image_base64: z.string(),
              mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            }),
          }),
        },
      },
    },
    async (req) => {
      const contentType = req.headers['content-type'] ?? '';
      const isMultipart = contentType.includes('multipart/form-data');

      let uploadBuffer: Buffer | undefined;
      let rawBody: Record<string, unknown> = {};

      if (isMultipart) {
        const data = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES } });
        if (!data) throw new AppError(400, 'CAPTION_NO_FILE', 'No file found in multipart body. Field name harus `file`.');
        if (!data.mimetype?.startsWith('image/')) {
          throw new AppError(400, 'CAPTION_INVALID_FILE', 'Uploaded file must be an image');
        }
        uploadBuffer = await data.toBuffer();
        if (uploadBuffer.length === 0) throw new AppError(400, 'CAPTION_EMPTY_FILE', 'Image file is empty');

        // Multipart caption options (caption_text, position, dst.) dikirim via query params.
        rawBody = req.query as Record<string, unknown>;
      } else {
        rawBody = (req.body as Record<string, unknown>) ?? {};
      }

      const parsed = CaptionBody.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError(400, 'CAPTION_INVALID_BODY', parsed.error.issues.map((i) => i.message).join('; '));
      }

      const result = await generateCaption({ uploadBuffer, body: parsed.data, signal: undefined });

      return {
        ok: true as const,
        data: {
          image_base64: result.buffer.toString('base64'),
          mime_type: result.mimeType,
        },
      };
    },
  );
};

export default captionRoutes;
