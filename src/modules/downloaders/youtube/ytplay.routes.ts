import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ytSearch, ytultraGetAudio } from './ytultra.js';
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
      const query = req.query.query.trim();

      let videoUrl: string;
      let source: 'url' | 'search';

      if (isYoutubeUrl(query)) {
        videoUrl = query;
        source = 'url';
      } else {
        const searched = await ytSearch(query);
        videoUrl = `https://www.youtube.com/watch?v=${searched.videoId}`;
        source = 'search';
      }

      const result = await ytultraGetAudio(videoUrl);

      const base = `${req.protocol}://${req.host}`;
      const safeTitle = result.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'youtube-audio';
      const proxyUrl = shortProxyUrl(base, result.audioUrl, {
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
          source,
          format: result.format,
          quality: result.quality,
          size: result.size,
          url: proxyUrl,
        },
      };
    },
  );
};

export default ytplayRoutes;