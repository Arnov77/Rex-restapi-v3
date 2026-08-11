import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { ytdlpDownloadAudio, getTempDir } from './ytdlp.js';
import { YtPlayQuery } from './ytplay.schemas.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

function isYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /(^|\.)youtube\.com$/i.test(url.hostname)
      || /(^|\.)youtu\.be$/i.test(url.hostname)
      || /(^|\.)youtube-nocookie\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function toYtDlpInput(query: string): { input: string; type: 'url' | 'search' } {
  const trimmed = query.trim();

  if (isYoutubeUrl(trimmed)) {
    return { input: trimmed, type: 'url' };
  }

  return { input: `ytsearch1:${trimmed}`, type: 'search' };
}

const ytplayRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Search YouTube and convert the result to MP3.',
        description: 'Accepts a search query or a direct YouTube URL.',
        querystring: YtPlayQuery,
      },
    },
    async (req) => {
      const parsed = toYtDlpInput(req.query.query);
      const result = await ytdlpDownloadAudio(parsed.input);

      const base = `${req.protocol}://${req.host}`;
      const fileId = basename(result.filePath);
      const internalUrl = `${base}/api/downloader/ytplay/file/${fileId}`;
      const safeTitle = result.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'youtube-audio';
      const proxyUrl = shortProxyUrl(base, internalUrl, {
        filename: `${safeTitle}.mp3`,
        contentType: 'audio/mpeg',
      });

      return {
        ok: true,
        data: {
          title: result.title,
          author: result.author,
          thumbnail: result.thumbnail,
          duration: result.duration,
          source: parsed.type,
          url: proxyUrl,
          format: 'mp3',
        },
      };
    },
  );

  app.get(
    '/file/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      if (!/^[a-f0-9]+\.mp3$/.test(id)) {
        return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
      }

      const filePath = `${getTempDir()}/${id}`;

      try {
        const stat = statSync(filePath);

        reply
          .type('audio/mpeg')
          .header('content-length', String(stat.size))
          .header('content-disposition', `inline; filename="${id}"`)
          .header('cache-control', 'private, max-age=3600');

        return reply.send(createReadStream(filePath));
      } catch {
        return reply.code(404).send({ ok: false, error: { message: 'File expired or not found' } });
      }
    },
  );
};

export default ytplayRoutes;
