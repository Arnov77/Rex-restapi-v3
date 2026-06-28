import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
/**
 * Swagger / OpenAPI auto-generation. Routes only need to declare their
 * schema with Zod and add `tags` + `summary` — docs appear at /docs.
 */
export default fp(async (app) => {
    await app.register(swagger, {
        openapi: {
            openapi: '3.1.0',
            info: {
                title: 'Rex API',
                description: 'WhatsApp-bot oriented REST API.',
                version: '3.0.0',
            },
            servers: [{ url: '/', description: 'current host' }],
            components: {
                securitySchemes: {
                    apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
                    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
                },
            },
            tags: [
                { name: 'health', description: 'Liveness & readiness' },
                { name: 'maker', description: 'Image generators (brat, quote)' },
                { name: 'tool', description: 'Web utilities (screenshot)' },
            ],
        },
        transform: (args) => {
            const transformed = jsonSchemaTransform(args);
            const isExifRoute = args.url === '/api/exif/' ||
                args.url === '/api/exif' ||
                args.url.endsWith('/exif/') ||
                args.url.endsWith('/exif');
            if (isExifRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    /**
                     * Ini penting supaya @fastify/swagger bikin requestBody
                     * sebagai multipart/form-data, bukan application/json.
                     */
                    consumes: ['multipart/form-data'],
                    /**
                     * Ini raw JSON Schema AMAN karena dipasang setelah
                     * jsonSchemaTransform, bukan langsung di route Zod.
                     */
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'Image file (jpeg, png, webp, tiff, heic)',
                            },
                        },
                        required: ['file'],
                    },
                };
            }
            const isSttRoute = args.url === '/api/ai/stt/' ||
                args.url === '/api/ai/stt' ||
                args.url.endsWith('/stt/') ||
                args.url.endsWith('/stt');
            if (isSttRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File audio (mp3, mp4, ogg, wav, webm, m4a) — max 25MB. Opsional jika sudah isi ?url=',
                            },
                        },
                    },
                };
            }
            const isRemoveBgRoute = args.url === '/api/tools/removebg/' ||
                args.url === '/api/tools/removebg' ||
                args.url.endsWith('/removebg/') ||
                args.url.endsWith('/removebg');
            if (isRemoveBgRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'Image file (jpg, jpeg, png, webp) — max 10MB. Opsional jika sudah isi ?image_url=',
                            },
                        },
                    },
                };
            }
            const isChangeBgRoute = args.url === '/api/tools/changebg/' ||
                args.url === '/api/tools/changebg' ||
                args.url.endsWith('/changebg/') ||
                args.url.endsWith('/changebg');
            if (isChangeBgRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'Image file (jpg, jpeg, png, webp) — max 10MB. Opsional jika sudah isi ?image_url=',
                            },
                        },
                    },
                };
            }
            const isOcrRoute = args.url === '/api/tools/ocr/' ||
                args.url === '/api/tools/ocr' ||
                args.url.endsWith('/ocr/') ||
                args.url.endsWith('/ocr');
            if (isOcrRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File gambar (JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC) — max 20MB. Opsional jika sudah isi ?image=',
                            },
                        },
                    },
                };
            }
            const isAnimeRoute = args.url === '/api/tools/anime/' ||
                args.url === '/api/tools/anime' ||
                args.url.endsWith('/anime/') ||
                args.url.endsWith('/anime');
            if (isAnimeRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File gambar (JPEG, PNG) — max 20MB. Opsional jika sudah isi ?image=',
                            },
                        },
                    },
                };
            }
            const isHitamRoute = args.url === '/api/tools/hitam/' ||
                args.url === '/api/tools/hitam' ||
                args.url.endsWith('/hitam/') ||
                args.url.endsWith('/hitam');
            if (isHitamRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File gambar (JPEG, PNG) — max 20MB. Opsional jika sudah isi ?image=',
                            },
                        },
                    },
                };
            }
            const isTofigureRoute = args.url === '/api/tools/tofigure/' ||
                args.url === '/api/tools/tofigure' ||
                args.url.endsWith('/tofigure/') ||
                args.url.endsWith('/tofigure');
            if (isTofigureRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File gambar (JPEG, PNG) — max 20MB. Opsional jika sudah isi ?image=',
                            },
                        },
                    },
                };
            }
            const isNsfwRoute = args.url === '/api/tools/nsfw/' ||
                args.url === '/api/tools/nsfw' ||
                args.url.endsWith('/nsfw/') ||
                args.url.endsWith('/nsfw');
            if (isNsfwRoute) {
                transformed.schema = {
                    ...transformed.schema,
                    consumes: ['multipart/form-data'],
                    body: {
                        type: 'object',
                        properties: {
                            file: {
                                type: 'string',
                                format: 'binary',
                                description: 'File gambar (JPEG, PNG, GIf, Webp, MP4) — max 20MB. Opsional jika sudah isi ?image=',
                            },
                        },
                    },
                };
            }
            return transformed;
        },
    });
    await app.register(swaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: true,
        },
    });
}, { name: 'swagger', dependencies: [] });
//# sourceMappingURL=swagger.js.map