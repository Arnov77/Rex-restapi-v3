import { TwitterQuery, TwitterResponse } from './twitter.schemas.js';
import { downloadTwitter } from './twitter.service.js';
import { shortProxyUrl } from '../../downloaders/_proxy/proxy.token.js';
const twitterRoutes = async (app) => {
    app.get('/', {
        schema: {
            tags: ['download'],
            summary: 'Download Twitter/X media',
            description: 'Returns metadata + proxy URLs for videos, images, and GIFs from tweets.',
            querystring: TwitterQuery,
            response: { 200: TwitterResponse },
        },
    }, async (req) => {
        const result = await downloadTwitter(req.query.url);
        // Replace raw media URLs with signed proxy URLs
        const base = `${req.protocol}://${req.host}`;
        const media = result.media.map((m, i) => {
            const ext = m.type === 'video' ? 'mp4' : m.type === 'gif' ? 'mp4' : 'jpg';
            const ct = m.type === 'video' || m.type === 'gif' ? 'video/mp4' : 'image/jpeg';
            return {
                ...m,
                url: shortProxyUrl(base, m.url, {
                    filename: `twitter_${i + 1}.${ext}`,
                    contentType: ct,
                }),
            };
        });
        return { ok: true, data: { ...result, media } };
    });
};
export default twitterRoutes;
//# sourceMappingURL=twitter.routes.js.map