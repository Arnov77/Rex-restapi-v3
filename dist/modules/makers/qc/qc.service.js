import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withPage } from '../../../shared/browser/browserManager.js';
import { Internal } from '../../../shared/errors.js';
import { LruCache } from '../../../shared/utils/lruCache.js';
import { assertPublicUrl } from '../../../shared/utils/ssrfGuard.js';
import { renderQcHtml } from './qc.template.js';
const MIME = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};
// WA sticker spec: 512x512, max 500KB, WebP with transparency
const STICKER_SIZE = 512;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map();
function cacheKey(opts) {
    const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
    return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}
export async function generate(opts, { signal } = {}) {
    if (opts.avatar)
        await assertPublicUrl(opts.avatar);
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
    const html = renderQcHtml(opts);
    const png = await withPage(async (page) => {
        await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
        await page
            .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 5_000 })
            .catch(() => { });
        const el = await page.$('#canvas');
        if (!el)
            throw Internal('QC canvas element not found');
        return el.screenshot({ type: 'png', omitBackground: true });
    }, { viewport: { width: 512, height: 512 }, deviceScaleFactor: 2, signal });
    if (!png || png.length === 0)
        throw Internal('QC produced empty buffer');
    let buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
    // Selalu resize ke 512x512 dengan contain + transparent bg
    // supaya cocok sebagai WA sticker
    buffer = await sharp(buffer)
        .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
        .toBuffer();
    // Format conversion
    if (opts.format === 'jpeg') {
        // JPEG tidak support transparansi — flatten ke putih
        buffer = await sharp(buffer)
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: opts.quality })
            .toBuffer();
    }
    else if (opts.format === 'webp') {
        buffer = await sharp(buffer).webp({ quality: opts.quality, effort: 3 }).toBuffer();
    }
    else {
        // PNG — pertahankan transparansi
        buffer = await sharp(buffer).png().toBuffer();
    }
    return { buffer, mimeType: MIME[opts.format], format: opts.format };
}
export const qcService = { generate, cache };
//# sourceMappingURL=qc.service.js.map