import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { downloadYoutube } from './youtube.service.js';

const YoutubeQuery = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
  quality: z.enum(['1080', '720', '480', '360']).default('720').optional(),
});

const youtubeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download YouTube video (merged mp4 with audio)',
        description: 'Downloads and merges video+audio into a single streamable mp4. Supports quality selection.',
        querystring: YoutubeQuery,
      },
    },
    async (req, reply) => {
      const quality = req.query.quality || '720';
      const result = await downloadYoutube(req.query.url, quality);
      const media = result.media[0]!;

      const stat = statSync(media.filePath);
      const filename = `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')} (${media.quality}).mp4`;

      reply.raw.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      });

      await pipeline(createReadStream(media.filePath), reply.raw);
      reply.hijack();
    },
  );
};

export default youtubeRoutes;
