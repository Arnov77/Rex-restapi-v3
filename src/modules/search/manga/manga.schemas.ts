import { z } from 'zod';

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

const MangaItem = z.object({
  title: z.string(),
  url: z.string(),
  thumbnail: z.string().nullable(),
  type: z.string().nullable(),
  genre: z.string().nullable(),
  latestChapter: z.string().nullable(),
});

const MangaDetail = z.object({
  title: z.string(),
  alternativeTitle: z.string().nullable(),
  url: z.string(),
  thumbnail: z.string().nullable(),
  type: z.string().nullable(),
  theme: z.string().nullable(),
  genres: z.array(z.string()),
  author: z.string().nullable(),
  status: z.string().nullable(),
  rating: z.string().nullable(),
  views: z.string().nullable(),
  synopsis: z.string().nullable(),
  chapters: z.array(z.object({ title: z.string(), url: z.string() })),
});

const MangaLatest = z.object({
  title: z.string(),
  url: z.string(),
  chapters: z.array(z.object({ title: z.string(), url: z.string() })),
});

const MangaChapterImages = z.object({
  chapter: z.string(),
  url: z.string(),
  total: z.number(),
  images: z.array(z.string()),
});

// ─── Query ────────────────────────────────────────────────────────────────────

export const MangaSearchQuery = z.object({
  action: z
    .enum(['search', 'detail', 'latest', 'chapter'])
    .describe([
      '"search" — cari manga berdasarkan kata kunci',
      '"detail" — detail manga dari URL atau judul',
      '"latest" — ambil daftar chapter terbaru dari URL manga',
      '"chapter" — ambil semua gambar dari URL chapter',
    ].join(' | ')),
  q: z
    .string()
    .min(1)
    .max(300)
    .describe('Kata kunci / URL manga / URL chapter tergantung action'),
});

export type MangaSearchQuery = z.infer<typeof MangaSearchQuery>;

// ─── Response ─────────────────────────────────────────────────────────────────

export const MangaApiResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    action: z.enum(['search', 'detail', 'latest', 'chapter']),
    query: z.string(),
    results: z.array(MangaItem).optional(),
    result: MangaDetail.optional(),
    latest: MangaLatest.optional(),
    chapter: MangaChapterImages.optional(),
  }),
});

export type MangaApiResponse = z.infer<typeof MangaApiResponse>;
