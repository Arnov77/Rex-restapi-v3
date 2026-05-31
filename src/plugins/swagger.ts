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

        const isExifRoute =
          args.url === '/api/exif/' ||
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