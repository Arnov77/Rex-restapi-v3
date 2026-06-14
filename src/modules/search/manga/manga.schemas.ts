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
  chapters: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
    }),
  ),
});

// ─── Query ────────────────────────────────────────────────────────────────────

export const MangaSearchQuery = z.object({
  action: z
    .enum(['search', 'detail'])
    .describe('"search" untuk mencari manga, "detail" untuk detail manga'),
  q: z
    .string()
    .min(1)
    .max(300)
    .describe('Kata kunci pencarian (action=search) atau URL halaman manga (action=detail)'),
});

export type MangaSearchQuery = z.infer<typeof MangaSearchQuery>;

// ─── Response ─────────────────────────────────────────────────────────────────
//
// Fastify + zod serializer tidak bisa pakai discriminatedUnion di level root
// response karena ia mencari discriminator di top-level object, bukan di
// dalam nested field. Solusinya: satu schema "superposition" yang membuat
// semua field optional kecuali yang selalu ada (ok).
//
// Alternatif lebih bersih: gunakan z.union() langsung — Fastify akan
// mencoba tiap variant dan memakai yang pertama cocok saat serialisasi.

export const MangaApiResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    action: z.enum(['search', 'detail']),
    query: z.string(),
    // search mode
    results: z.array(MangaItem).optional(),
    // detail mode
    result: MangaDetail.optional(),
  }),
});

export type MangaApiResponse = z.infer<typeof MangaApiResponse>;