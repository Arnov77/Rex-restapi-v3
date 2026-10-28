// src/modules/downloaders/youtube/youtube.routes.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { downloadYoutube } from './youtube.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const YoutubeQuery = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
  quality: z.enum(['1080', '720', '480', '360', '240', '144']).default('720').optional(),
});

function parseHeight(q: string): number {
  const n = q.match(/(\d{2,4})\s*p/i);
  return n?.[1] ? parseInt(n[1], 10) : 0;
}

const youtubeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download a YouTube video.',
        querystring: YoutubeQuery,
      },
    },
    async (req) => {
      const targetQuality = req.query.quality || '720';
      const result = await downloadYoutube(req.query.url, targetQuality);

      const base = `${req.protocol}://${req.host}`;
      const safeTitle = result.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'video';

      let selectedMedia = result.media;

      // Selalu kembalikan 1 video yang sesuai/mendekati quality yang diminta.
      // (Parameter "all" sudah dihapus: di jalur scrapr hanya ada 1 kualitas
      // per panggilan, jadi all=true dan all=false hasilnya sama — dan skema
      // enum-nya justru menimbulkan error "invalid parameter" bila klien
      // mengirim nilai selain 'true'/'false'. Param tak dikenal kini
      // diabaikan zod, jadi klien lama yang masih mengirim all=... tidak
      // akan error lagi.)
      if (result.media.length > 0) {
        const targetHeight = parseInt(targetQuality, 10);
        
        // Cari video yang tingginya <= targetHeight, atau ambil yang tertinggi jika tidak ada
        const pick =
          result.media.find((m) => parseHeight(m.quality) <= targetHeight) ??
          result.media[0];

        selectedMedia = pick ? [pick] : [];
      }

      // Berikan proxy URL untuk media yang dipilih
      const mediaList = selectedMedia.map((m) => ({
        type: m.type,
        quality: m.quality,
        format: m.format,
        size: m.size,
        url: shortProxyUrl(base, m.url, {
          filename: `${safeTitle} (${m.quality}).${m.format}`,
          contentType: 'video/mp4',
        }),
      }));

      return {
        ok: true,
        data: {
          title: result.title,
          author: result.author,
          thumbnail: result.thumbnail,
          duration: result.duration,
          media: mediaList,
          resolver: result.source,
        },
      };
    },
  );
};

export default youtubeRoutes;