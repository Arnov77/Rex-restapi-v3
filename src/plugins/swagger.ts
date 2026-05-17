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
          // Public, developer-facing taxonomy. Auth/me/api-keys routes
          // are still mounted but flagged `hide: true` so they don't
          // surface in /docs or /docs/json — see auth.routes.ts and
          // friends. The dashboard groups its sidebar by these tags
          // verbatim, so any rename here is observable in the UI.
          { name: 'health', description: 'Liveness & readiness' },
          { name: 'maker', description: 'Image generators (brat, quote)' },
          { name: 'tool', description: 'Web utilities (screenshot)' },
        ],
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  },
  { name: 'swagger', dependencies: [] },
);
