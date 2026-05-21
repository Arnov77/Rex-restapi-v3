import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
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

      const buffer = readFileSync(result.filePath);
      const filename = `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.mp3`;

      return reply
        .type('audio/mpeg')
        .header('content-disposition', `inline; filename="${filename}"`)
        .header('cache-control', 'private, max-age=3600')
        .send(buffer);
    },
  );
};

export default ytmp3Routes;
