const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const { env } = require('../../../config');

// `apis` is a list of glob patterns where JSDoc `@openapi` blocks live. The
// spec is rebuilt once at module import, not per-request, so adding a new
// route requires a server restart — acceptable for a low-churn internal doc.
const ROUTES_GLOB = path.join(__dirname, '../../core/**/*.routes.js');

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Rex REST API',
      version: env.API_VERSION,
      description:
        'Unified API surface for media scrapers (YouTube/TikTok/Instagram), image ' +
        'generators (Brat/Quote/MIQ/Smeme), Telegram sticker conversion, Google ' +
        'Drive link resolution, Minecraft profile lookup, and SDXL image generation.',
    },
    servers: [{ url: '/', description: 'Current host' }],
    tags: [
      { name: 'Media', description: 'YouTube, TikTok, Instagram, Brat' },
      { name: 'Tools', description: 'Quote, MIQ, Smeme, GDrive, Telegram, Promosi' },
      { name: 'AI', description: 'SDXL / Replicate image generation' },
    ],
  },
  apis: [ROUTES_GLOB],
});

module.exports = spec;
