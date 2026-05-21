import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ytdlpDownloadAudio } from './ytdlp.js';

const Ytmp3Query = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
});

const ytmp3Routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'YouTube to MP3',
        description: 'Extract and convert audio from YouTube video to MP3. Streams the file directly.',
        querystring: Ytmp3Query,
      },
    },
    async (req, reply) => {
      const result = await ytdlpDownloadAudio(req.query.url);

      const stat = statSync(result.filePath);
      const filename = `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.mp3`;

      reply.raw.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      });

      await pipeline(createReadStream(result.filePath), reply.raw);
      reply.hijack();
    },
  );
};

export default ytmp3Routes;
