import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createReadStream, statSync } from 'node:fs';
import { z } from 'zod';
import { SpotifyQuery, SpotifyResponse } from './spotify.schemas.js';
import { downloadSpotify } from './spotify.service.js';
import { getSpotifyFile } from './spotify.store.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const spotifyRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'spotify',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many Spotify download requests',
  });


  app.get('/debug-playlist3', async (req) => {
  const res = await fetch(
    'https://open.spotify.com/embed/playlist/4BFInZOeil84cUr7L9492Y?utm_source=oembed',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }
  );
  const html = await res.text();

  // Cari JSON embedded
  const nextData = html.match(/<script[^>]*>({"props".*?)<\/script>/s)?.[1];
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});<\/script>/s)?.[1];
  
  return {
    hasNextData: !!nextData,
    hasInitialState: !!stateMatch,
    nextDataSnippet: nextData?.slice(0, 1000),
    stateSnippet: stateMatch?.slice(0, 1000),
    htmlSnippet: html.slice(0, 500),
  };
});
  
  // GET /api/downloader/spotify
  app.get(
    '/',
    {
      preHandler: [limit],
      schema: {
        tags: ['download'],
        summary: 'Download Spotify track / album / playlist',
        description:
          'Download lagu dari Spotify sebagai MP3. Support track, album, dan playlist. ' +
          'URL yang dikembalikan adalah short proxy URL yang bisa di-stream langsung.',
        querystring: SpotifyQuery,
        response: { 200: SpotifyResponse },
      },
    },
    async (req) => {
      const base = `${req.protocol}://${req.host}`;
      const { type, tracks } = await downloadSpotify(req.query.q, base);
      return { ok: true as const, data: { type, tracks } };
    },
  );

  // GET /api/downloader/spotify/file/:id — serve file MP3 (dipanggil oleh proxy internal)
  app.get(
    '/file/:id',
    { schema: { hide: true, params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const entry = getSpotifyFile(req.params.id);
      if (!entry) {
        return reply.code(404).send({ ok: false, error: { message: 'File tidak ditemukan atau sudah expired' } });
      }

      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(entry.filePath);
      } catch {
        return reply.code(404).send({ ok: false, error: { message: 'File tidak ditemukan di disk' } });
      }

      const fileSize = stat.size;
      const rangeHeader = req.headers['range'];
      const safeFilename = encodeURIComponent(entry.filename);

      if (rangeHeader) {
        // Partial content untuk streaming
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? parseInt(match[1], 10) : 0;
        const end = match?.[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          return reply.code(416).header('content-range', `bytes */${fileSize}`).send();
        }

        return reply
          .code(206)
          .header('content-type', 'audio/mp4')
          .header('content-length', String(end - start + 1))
          .header('content-range', `bytes ${start}-${end}/${fileSize}`)
          .header('accept-ranges', 'bytes')
          .header('content-disposition', `inline; filename="${safeFilename}"`)
          .header('cache-control', 'private, max-age=600')
          .send(createReadStream(entry.filePath, { start, end }));
      }

      // Full response dengan inline supaya bisa di-stream/play di browser
      return reply
        .code(200)
        .header('content-type', 'audio/mp4')
        .header('content-length', String(fileSize))
        .header('accept-ranges', 'bytes')
        .header('content-disposition', `inline; filename="${safeFilename}"`)
        .header('cache-control', 'private, max-age=600')
        .send(createReadStream(entry.filePath));
    },
  );
};

export default spotifyRoutes;