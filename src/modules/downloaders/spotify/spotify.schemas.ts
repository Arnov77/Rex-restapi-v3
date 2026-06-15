import { z } from 'zod';

export const SpotifyQuery = z.object({
  q: z
    .string()
    .min(1)
    .describe('URL Spotify (track/album/playlist) atau nama lagu, misal: "everything u are hindia"'),
});

export type SpotifyQuery = z.infer<typeof SpotifyQuery>;

const SpotifyTrack = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable(),
  playlist: z.string().nullable(),
  duration: z.number().nullable(),
  url: z.string().describe('Short proxy URL untuk streaming m4a (valid 10 menit)'),
});

export const SpotifyResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    type: z.enum(['track', 'album', 'playlist']),
    tracks: z.array(SpotifyTrack),
  }),
});