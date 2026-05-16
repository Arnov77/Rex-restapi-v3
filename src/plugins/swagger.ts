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
          { name: 'auth', description: 'Register / login / session' },
          { name: 'me', description: 'Self-service: profile, key, usage' },
          { name: 'api-keys', description: 'Manage API keys (admin)' },
          { name: 'screenshot', description: 'URL screenshot capture' },
          { name: 'brat', description: 'Brat caption renderer' },
          { name: 'quote', description: 'Twitter-style quote card' },
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
