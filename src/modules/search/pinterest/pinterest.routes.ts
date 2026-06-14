import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PinterestSearchQuery, PinterestSearchResponse } from './pinterest.schemas.js';
import { searchPinterest } from './pinterest.service.js';

const pinterestSearchRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'search-pinterest',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many Pinterest search requests',
  });

  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['search'],
        summary: 'Cari gambar di Pinterest',
        description: 'Cari pin/gambar di Pinterest berdasarkan kata kunci.',
        querystring: PinterestSearchQuery,
        response: { 200: PinterestSearchResponse },
      },
    },
    async (req) => {
      const { q, limit: lim } = req.query;
      const results = await searchPinterest(q, lim);

      // Pastikan field nullable tetap terkirim sebagai null, bukan undefined.
      // Fastify + Zod response serializer akan error kalau property yang required bernilai undefined.
      const safeResults = results.map((item) => ({
        id: item.id || '0',
        title: item.title ?? null,
        image: item.image ?? null,
        thumbnail: item.thumbnail ?? item.image ?? null,
        board: item.board ?? null,
        username: item.username ?? null,
        source: item.source ?? null,
      }));

      return { ok: true as const, data: { query: q, results: safeResults } };
    },
  );
};

export default pinterestSearchRoutes;
