import { z } from 'zod';
import { exifService } from './exif.service.js';
const ExifPostQuery = z.object({
    image: z
        .string()
        .url()
        .max(2048)
        .optional()
        .describe('Public image URL — gunakan ini ATAU upload file di bawah'),
});
/*
const ExifPostBody = z
  .any()
  .optional()
  .describe('Multipart form-data body. Use field name: file');
*/
const exifRoutes = async (app) => {
    const quota = app.quota({ message: 'Daily EXIF quota exceeded' });
    const limit = app.rateLimit({
        prefix: 'exif',
        windowSec: 60,
        max: 5,
        keyGenerator: (req) => req.apiKey?.id ?? req.ip,
        message: 'Too many EXIF requests',
    });
    app.post('/', {
        preHandler: [quota, limit],
        schema: {
            tags: ['tools'],
            summary: 'Extract EXIF metadata from image URL or file upload',
            description: 'Ambil metadata EXIF dari public image URL lewat query `?image=...` atau upload file dengan multipart/form-data field `file`.',
            querystring: ExifPostQuery,
            /**
             * Jangan pakai raw JSON Schema di sini.
             * Kalau body diisi:
             *
             * body: {
             *   type: 'object',
             *   properties: ...
             * }
             *
             * fastify-type-provider-zod bakal mencoba convert sebagai Zod
             * dan bisa error: Cannot read properties of undefined (reading typeName)
             
            body: ExifPostBody,
            */
            response: {
                200: z.object({
                    ok: z.literal(true),
                    data: z.any(),
                }),
                400: z.object({
                    ok: z.literal(false),
                    error: z.object({
                        message: z.string(),
                    }),
                }),
                500: z.object({
                    ok: z.literal(false),
                    error: z.object({
                        message: z.string(),
                    }),
                }),
            },
        },
    }, async (req, reply) => {
        const contentType = req.headers['content-type'] ?? '';
        const isMultipart = contentType.includes('multipart/form-data');
        // ── File upload ───────────────────────────────────────────────────────
        if (isMultipart) {
            if (typeof req.file !== 'function') {
                return reply.code(500).send({
                    ok: false,
                    error: {
                        message: '@fastify/multipart belum ter-register. Register plugin multipart dulu di app utama.',
                    },
                });
            }
            const data = await req.file({
                limits: {
                    fileSize: 20 * 1024 * 1024,
                    files: 1,
                },
            });
            if (!data) {
                return reply.code(400).send({
                    ok: false,
                    error: {
                        message: 'No file found in multipart body. Field name harus `file`.',
                    },
                });
            }
            if (data.fieldname !== 'file') {
                return reply.code(400).send({
                    ok: false,
                    error: {
                        message: `Invalid field name: ${data.fieldname}. Gunakan field name: file`,
                    },
                });
            }
            const allowedMimeTypes = [
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/tiff',
                'image/heic',
                'image/heif',
            ];
            if (!allowedMimeTypes.includes(data.mimetype)) {
                return reply.code(400).send({
                    ok: false,
                    error: {
                        message: `Unsupported file type: ${data.mimetype}`,
                    },
                });
            }
            const buf = await data.toBuffer();
            if (!buf.length) {
                return reply.code(400).send({
                    ok: false,
                    error: {
                        message: 'Uploaded file is empty',
                    },
                });
            }
            const result = await exifService.extractFromBuffer(buf);
            return {
                ok: true,
                data: result,
            };
        }
        // ── URL via query param ───────────────────────────────────────────────
        const { image } = req.query;
        if (!image) {
            return reply.code(400).send({
                ok: false,
                error: {
                    message: 'Provide either ?image=<url> or upload a file as multipart/form-data field `file`',
                },
            });
        }
        const result = await exifService.extractFromUrl({ image });
        return {
            ok: true,
            data: result,
        };
    });
};
export default exifRoutes;
//# sourceMappingURL=exif.routes.js.map