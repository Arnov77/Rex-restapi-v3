import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MangaSearchQuery, MangaApiResponse } from './manga.schemas.js';
import { searchManga, getMangaDetail } from './manga.service.js';

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
        summary: 'Cari atau ambil detail manga dari Komiku',
        description: [
          'Dua mode operasi via query param **action**:',
          '',
          '- `action=search` — Mencari manga berdasarkan kata kunci (`q`).',
          '- `action=detail` — Mengambil detail lengkap manga dari URL halaman komiku (`q`).',
          '',
          'Contoh:',
          '- `/api/search/manga?action=search&q=naruto`',
          '- `/api/search/manga?action=detail&q=https://komiku.org/manga/komik-one-piece-indo/`',
        ].join('\n'),
        querystring: MangaSearchQuery,
        response: { 200: MangaApiResponse },
      },
    },
    async (req) => {
      const { action, q } = req.query;

      if (action === 'search') {
        const results = await searchManga(q);
        return {
          ok: true as const,
          data: { action: 'search' as const, query: q, results },
        };
      }

      // action === 'detail'
      const result = await getMangaDetail(q);
      return {
        ok: true as const,
        data: { action: 'detail' as const, query: q, result },
      };
    },
  );
};

export default mangaSearchRoutes;