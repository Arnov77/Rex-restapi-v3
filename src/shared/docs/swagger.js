const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const { env } = require('../../../config');

// `apis` is a list of glob patterns where JSDoc `@openapi` blocks live. The
// spec is rebuilt once at module import, not per-request, so adding a new
// route requires a server restart — acceptable for a low-churn internal doc.
const ROUTES_GLOB = path.join(__dirname, '../../core/**/*.routes.js');

const fullSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Rex REST API',
      version: env.API_VERSION,
      description:
        'Unified API surface for media scrapers (YouTube/TikTok/Instagram), image ' +
        'generators (Brat/Quote/MIQ/Smeme), Telegram sticker conversion, Google ' +
        'Drive link resolution, Minecraft profile lookup, NSFW detection, and SDXL ' +
        'image generation.',
    },
    servers: [{ url: '/', description: 'Current host' }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description:
            'Plaintext API key (format: rex_<base64url>). Bearer token in the ' +
            'Authorization header is also accepted. Endpoints are accessible ' +
            'without a key (anon tier) at a tighter rate limit; supplying a ' +
            'user-tier key unlocks the higher quota.',
        },
      },
    },
    // Two alternatives: anonymous ({}) or apiKey. Operations stay open to anon
    // by default; supplying the key just unlocks the higher quota tier.
    security: [{}, { apiKey: [] }],
    tags: [
      { name: 'Media', description: 'YouTube, TikTok, Instagram, Brat' },
      { name: 'Tools', description: 'Quote, MIQ, Smeme, GDrive, Telegram, Promosi, NSFW' },
      { name: 'Auth', description: 'Account registration and login' },
      { name: 'User', description: 'Authenticated dashboard endpoints' },
    ],
  },
  apis: [ROUTES_GLOB],
});

// Strip /api/admin/* paths and the `Admin` tag from the public spec.
// Admin endpoints still exist and are still gated by `requireMaster` — they
// are simply hidden from Swagger so casual readers don't see internal tools
// listed alongside public endpoints. Master users can read source code or
// use curl directly.
function stripAdmin(srcSpec) {
  const filtered = { ...srcSpec };
  if (filtered.paths) {
    filtered.paths = Object.fromEntries(
      Object.entries(filtered.paths).filter(([p]) => !p.startsWith('/api/admin'))
    );
  }
  if (Array.isArray(filtered.tags)) {
    filtered.tags = filtered.tags.filter((t) => t.name !== 'Admin');
  }
  return filtered;
}

const spec = stripAdmin(fullSpec);

module.exports = spec;
