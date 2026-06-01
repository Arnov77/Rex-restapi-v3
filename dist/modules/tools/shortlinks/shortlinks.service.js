import { randomBytes } from 'node:crypto';
import { NotFound, BadRequest } from '../../../shared/errors.js';
import { shortlinksRepo } from './shortlinks.repo.js';
const SLUG_LENGTH = 8; // 6 bytes → 8 base64url chars
function generateSlug() {
    return randomBytes(6).toString('base64url');
}
export function shortlinksService(db) {
    const repo = shortlinksRepo(db);
    return {
        async create(body, opts) {
            const slug = body.slug ?? generateSlug();
            // Cek limit untuk non-master user
            if (!opts.isMaster) {
                const existing = await (opts.userId
                    ? repo.findByUserId(opts.userId)
                    : opts.apiKeyId
                        ? repo.findByApiKeyId(opts.apiKeyId)
                        : []);
                if (existing.length >= 10) {
                    throw BadRequest('Maksimal 10 shortlinks untuk free tier');
                }
            }
            // Cek slug tidak bentrok
            const existing = await repo.findById(slug);
            if (existing) {
                throw BadRequest(body.slug
                    ? `Slug "${slug}" tidak tersedia, coba slug lain`
                    : 'Slug tidak tersedia, coba lagi');
            }
            const expires_at = body.expires_in
                ? new Date(Date.now() + body.expires_in * 86400 * 1000).toISOString()
                : null;
            return repo.create({
                id: slug,
                url: body.url,
                user_id: opts.userId ?? null,
                api_key_id: opts.apiKeyId ?? null,
                expires_at,
            });
        },
        async resolve(slug) {
            const link = await repo.findById(slug);
            if (!link)
                throw NotFound('Shortlink not found');
            // Cek expired
            if (link.expires_at && new Date(link.expires_at) < new Date()) {
                throw NotFound('Shortlink has expired');
            }
            // Increment click fire-and-forget
            void repo.incrementClick(slug).catch(() => { });
            return link;
        },
        async list(opts) {
            if (opts.userId)
                return repo.findByUserId(opts.userId);
            if (opts.apiKeyId)
                return repo.findByApiKeyId(opts.apiKeyId);
            return [];
        },
        async delete(slug, opts) {
            const link = await repo.findById(slug);
            if (!link)
                throw NotFound('Shortlink not found');
            // Pastikan hanya owner yang bisa hapus
            const isOwner = (opts.userId && link.user_id === opts.userId) ||
                (opts.apiKeyId && link.api_key_id === opts.apiKeyId);
            if (!isOwner)
                throw NotFound('Shortlink not found');
            await repo.delete(slug);
        },
    };
}
//# sourceMappingURL=shortlinks.service.js.map