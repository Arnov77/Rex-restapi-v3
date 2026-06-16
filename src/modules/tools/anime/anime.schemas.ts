import { z } from 'zod';

export const ANIME_STYLE = 'Photo-to-Anime' as const;
export const ANIME_PROMPT = 'Transform into anime.' as const;

export const AnimeQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar yang akan diubah ke anime'),
  seed: z
    .coerce.number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe('Seed untuk reproducibility. Kosongkan untuk random.'),
});

export type AnimeQuery = z.infer<typeof AnimeQuery>;
