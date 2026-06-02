import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TiktokQuery, TiktokResponse } from './tiktok.schemas.js';
import { downloadTiktok } from './tiktok.service.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const tiktokRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['download'],
        summary: 'Download TikTok video/slideshow',
        description: 'Returns metadata + proxy URLs for media (video without watermark, audio, images for slideshows).',
        querystring: TiktokQuery,
        response: { 200: TiktokResponse },
      },
    },
    async (req) => {
      const result = await downloadTiktok(req.query.url, req.raw.destroyed ? undefined : undefined);

      // Proxy all media through our domain.
      // tikwm blocks /video/music/ server-side, so audio uses
      // d.music_info.play (CDN direct URL) which IS proxyable.
      const base = `${req.protocol}://${req.host}`;
      const media = result.media
        .filter((m) => m.type !== 'audio') // audio is separate endpoint /api/download/ttmp3
        .map((m) => {
        // Skip proxy ONLY for tikwm /video/music/ paths (they 403)
        if (m.url.includes('tikwm.com/video/music/')) {
          return m; // fallback: direct URL (shouldn't happen with music_info.play fix)
        }
        const ext = m.type === 'video' ? 'mp4' : 'jpg';
        const ct = m.type === 'video' ? 'video/mp4' : 'image/jpeg';
        return {
          ...m,
          url: shortProxyUrl(base, m.url, {
            filename: `tiktok.${ext}`,
            contentType: ct,
          }),
        };
      });

      return { ok: true as const, data: { ...result, media } };
    },
  );
};

export default tiktokRoutes;
