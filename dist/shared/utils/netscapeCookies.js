import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../../config/env.js';
/**
 * Build a `Cookie` request-header value from the Netscape `cookies.txt` that
 * yt-dlp already uses (YTDLP_COOKIES_PATH), filtered to cookies whose domain
 * contains `domain` (e.g. "facebook.com", "instagram.com").
 *
 * Lets the in-app scrapers reuse the SAME single cookie file as yt-dlp instead
 * of a second source. Returns '' when the file is missing or has no match, so
 * callers transparently fall back to anonymous requests.
 */
export function cookieHeaderFor(domain) {
    try {
        const path = resolve(process.cwd(), loadEnv().YTDLP_COOKIES_PATH);
        if (!existsSync(path))
            return '';
        const pairs = [];
        for (let line of readFileSync(path, 'utf8').split('')) {
            if (line.startsWith('#HttpOnly_'))
                line = line.slice('#HttpOnly_'.length);
            else if (line.startsWith('#') || !line.trim())
                continue;
            const parts = line.split('\t');
            if (parts.length < 7)
                continue;
            const dom = parts[0];
            const name = parts[5];
            const value = parts[6].replace(/[\r]+$/, '');
            if (name && dom.toLowerCase().includes(domain.toLowerCase())) {
                pairs.push(`${name}=${value}`);
            }
        }
        return pairs.join('; ');
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=netscapeCookies.js.map