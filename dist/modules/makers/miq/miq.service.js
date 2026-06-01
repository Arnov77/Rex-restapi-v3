import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withPage } from '../../../shared/browser/browserManager.js';
import { Internal } from '../../../shared/errors.js';
import { LruCache } from '../../../shared/utils/lruCache.js';
import { assertPublicUrl } from '../../../shared/utils/ssrfGuard.js';
import { renderMiqHtml } from './miq.template.js';
const MIME = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};
const VIEWPORTS = {
    landscape: { width: 1200, height: 630 },
    portrait: { width: 630, height: 840 },
};
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map();
function cacheKey(opts) {
    const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
    return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}
export async function generate(opts, { signal } = {}) {
    await assertPublicUrl(opts.image);
    const key = cacheKey(opts);
    const cached = cache.get(key);
    if (cached)
        return cached;
    const existing = inflight.get(key);
    if (existing)
        return existing;
    const promise = renderOnce(opts, signal)
        .then((result) => {
        cache.set(key, result);
        return result;
    })
        .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
}
async function renderOnce(opts, signal) {
    const html = renderMiqHtml(opts);
    const viewport = VIEWPORTS[opts.orientation];
    const png = await withPage(async (page) => {
        await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
        await page
            .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 5_000 })
            .catch(() => { });
        const el = await page.$('#canvas');
        if (!el)
            throw Internal('MIQ canvas element not found');
        return el.screenshot({ type: 'png' });
    }, { viewport, signal });
    if (!png || png.length === 0)
        throw Internal('MIQ produced empty buffer');
    let buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
    if (opts.format === 'jpeg') {
        buffer = await sharp(buffer).jpeg({ quality: opts.quality }).toBuffer();
    }
    else if (opts.format === 'webp') {
        buffer = await sharp(buffer).webp({ quality: opts.quality, effort: 3 }).toBuffer();
    }
    return { buffer, mimeType: MIME[opts.format], format: opts.format };
}
export const miqService = { generate, cache };
//# sourceMappingURL=miq.service.js.map