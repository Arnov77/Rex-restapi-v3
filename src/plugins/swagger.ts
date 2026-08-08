import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * Swagger / OpenAPI auto-generation. Routes only need to declare their
 * schema with Zod and add `tags` + `summary` — docs appear at /docs.
 */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Rex API',
          description:
            'A single REST API for media downloaders, AI tools, image generators, ' +
            'games, and web utilities — built for bots, apps, and automations. ' +
            'Every endpoint below is documented and callable directly from this page.',
          version: '3.0.0',
        },
        servers: [{ url: '/', description: 'current host' }],
        components: {
          securitySchemes: {
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        // Order here controls the section order in /docs — grouped roughly by
        // what a new integrator would reach for first (auth/self-service),
        // then by feature area, then operator-only surfaces last.
        tags: [
          { name: 'health', description: 'Liveness and readiness checks.' },
          { name: 'auth', description: 'Register and sign in to get a JWT.' },
          { name: 'me', description: 'Self-service: your profile, API key, and usage.' },
          { name: 'download', description: 'Download media from YouTube, TikTok, Instagram, Spotify, and other platforms.' },
          { name: 'ai', description: 'AI-powered endpoints: chat, image generation, speech-to-text.' },
          { name: 'maker', description: 'Generate images: quote cards, captions, stickers, and similar.' },
          { name: 'tools', description: 'Web utilities: screenshots, OCR, translation, QR codes, background removal, and more.' },
          { name: 'search', description: 'Search manga and Pinterest.' },
          { name: 'shortlink', description: 'Create and manage short URLs.' },
          { name: 'games', description: 'Trivia and word-game endpoints (Indonesian-language content).' },
          { name: 'fun', description: 'Novelty endpoints (Indonesian-language content).' },
          { name: 'api-keys', description: 'Operator: create, rotate, and revoke API keys.' },
          { name: 'admin-users', description: 'Operator: manage registered users.' },
          { name: 'admin', description: 'Operator: sticker pack administration.' },
          { name: 'audit-log', description: 'Operator: view admin action history.' },
        ],
      },

      transform: (args) => {
        const transformed = jsonSchemaTransform(args);

        const isExifRoute =
          args.url === '/api/exif/' ||
          args.url === '/api/exif' ||
          args.url.endsWith('/exif/') ||
          args.url.endsWith('/exif');

        if (isExifRoute) {
          transformed.schema = {
            ...transformed.schema,

            /**
             * This is needed so @fastify/swagger marks the requestBody as
             * multipart/form-data instead of application/json.
             */
            consumes: ['multipart/form-data'],

            /**
             * This raw JSON Schema is safe to set here because it's applied
             * after jsonSchemaTransform, not directly on the Zod route schema.
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

        const isSttRoute =
          args.url === '/api/ai/stt/' ||
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
                  description: 'Audio file (mp3, mp4, ogg, wav, webm, m4a) — max 25MB. Optional if ?url= is already set.',
                },
              },
            },
          };
        }
        
        const isRemoveBgRoute =
          args.url === '/api/tools/removebg/' ||
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
                  description: 'Image file (jpg, jpeg, png, webp) — max 10MB. Optional if ?image_url= is already set.',
                },
              },
            },
          };
        }
        
        const isChangeBgRoute =
          args.url === '/api/tools/changebg/' ||
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
                  description: 'Image file (jpg, jpeg, png, webp) — max 10MB. Optional if ?image_url= is already set.',
                },
              },
            },
          };
        }

        const isOcrRoute =
          args.url === '/api/tools/ocr/' ||
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
                  description: 'Image file (JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC) — max 20MB. Optional if ?image= is already set.',
                },
              },
            },
          };
        }
        
        const isAnimeRoute =
          args.url === '/api/tools/anime/' ||
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
                  description: 'Image file (JPEG, PNG) — max 20MB. Optional if ?image= is already set.',
                },
              },
            },
          };
        }
        
        const isHitamRoute =
          args.url === '/api/tools/hitam/' ||
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
                  description: 'Image file (JPEG, PNG) — max 20MB. Optional if ?image= is already set.',
                },
              },
            },
          };
        }
        
        const isTofigureRoute =
          args.url === '/api/tools/tofigure/' ||
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
                  description: 'Image file (JPEG, PNG) — max 20MB. Optional if ?image= is already set.',
                },
              },
            },
          };
        }

        const isNsfwRoute =
          args.url === '/api/tools/nsfw/' ||
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
                  description: 'Image or video file (JPEG, PNG, GIF, WebP, MP4) — max 20MB. Optional if ?image= is already set.',
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
  },
  { name: 'swagger', dependencies: [] },
);