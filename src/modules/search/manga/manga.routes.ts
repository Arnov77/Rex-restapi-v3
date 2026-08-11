import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MangaSearchQuery, MangaApiResponse } from './manga.schemas.js';
import { searchManga, getMangaDetail, getLatestChapters, getChapterImages } from './manga.service.js';

const mangaSearchRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'search-manga',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many manga search requests',
  });
  
  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['search'],
        summary: 'Search manga, or fetch details, chapters, or latest releases.',
        description: 'Mode is selected via the `action` query parameter.',
        querystring: MangaSearchQuery,
        response: { 200: MangaApiResponse },
      },
    },
    async (req) => {
      const { action, q } = req.query;

      if (action === 'search') {
        const results = await searchManga(q);
        return { ok: true as const, data: { action: 'search' as const, query: q, results } };
      }

      if (action === 'latest') {
        const latest = await getLatestChapters(q);
        return { ok: true as const, data: { action: 'latest' as const, query: q, latest } };
      }

      if (action === 'chapter') {
        const chapter = await getChapterImages(q);
        return { ok: true as const, data: { action: 'chapter' as const, query: q, chapter } };
      }

      // action === 'detail'
      const result = await getMangaDetail(q);
      return { ok: true as const, data: { action: 'detail' as const, query: q, result } };
    },
  );
};

export default mangaSearchRoutes;