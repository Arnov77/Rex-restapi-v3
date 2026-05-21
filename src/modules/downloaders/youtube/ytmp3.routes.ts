import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createReadStream, statSync } from 'node:fs';
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

      reply.header('content-type', 'audio/mpeg');
      reply.header('content-length', String(stat.size));
      reply.header('content-disposition', `inline; filename="${filename}"`);
      reply.header('cache-control', 'private, max-age=3600');

      const stream = createReadStream(result.filePath);
      return reply.send(stream);
    },
  );
};

export default ytmp3Routes;
