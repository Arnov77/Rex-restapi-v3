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

  app.get('/debug-chapter', async (req) => {
  // Pakai chapter One Piece yang pasti ada
  const res = await fetch('https://komiku.org/one-piece-chapter-1185/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  // Cari semua img yang kemungkinan gambar chapter
  const imgs = [...html.matchAll(/src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/gi)].map(m => m[1]);
  return { total: imgs.length, sample: imgs.slice(0, 10) };
});
  
  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['search'],
        summary: 'Manga — search, detail, latest, chapter',
        description: [
          'Empat mode operasi via query param **action**:',
          '',
          '- `action=search` — Cari manga berdasarkan kata kunci (`q`)',
          '- `action=detail` — Detail lengkap manga dari URL atau judul (`q`)',
          '- `action=latest` — 10 chapter terbaru dari URL manga (`q`)',
          '- `action=chapter` — Semua gambar dari URL chapter (`q`)',
          '',
          'Contoh:',
          '- `?action=search&q=one piece`',
          '- `?action=detail&q=https://komiku.org/manga/komik-one-piece-indo/`',
          '- `?action=latest&q=https://komiku.org/manga/komik-one-piece-indo/`',
          '- `?action=chapter&q=https://komiku.org/one-piece-chapter-1/`',
        ].join('\n'),
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