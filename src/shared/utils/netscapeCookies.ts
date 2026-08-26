import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../../config/env.js';

/**
 * Build a `Cookie` request-header value from a Netscape `cookies.txt` file,
 * filtered to cookies whose domain contains `domain` (e.g. "facebook.com",
 * "instagram.com").
 *
 * By default reads the same cookies.txt yt-dlp uses (YTDLP_COOKIES_PATH),
 * so in-app scrapers can reuse it instead of needing a second source. Pass
 * `pathOverride` to read a different file instead (e.g. a dedicated logged-in
 * Instagram session separate from yt-dlp's YouTube cookies).
 *
 * Returns '' when the file is missing or has no match, so callers
 * transparently fall back to anonymous requests.
 */
export function cookieHeaderFor(domain: string, pathOverride?: string): string {
  try {
    const configuredPath = pathOverride || loadEnv().YTDLP_COOKIES_PATH;
    const path = resolve(process.cwd(), configuredPath);
    if (!existsSync(path)) return '';

    const pairs: string[] = [];
    for (let line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length);
      else if (line.startsWith('#') || !line.trim()) continue;

      const parts = line.split('\t');
      if (parts.length < 7) continue;

      const dom = parts[0]!;
      const name = parts[5]!;
      const value = parts[6]!.replace(/[\r]+$/, '');
      if (name && dom.toLowerCase().includes(domain.toLowerCase())) {
        pairs.push(`${name}=${value}`);
      }
    }
    return pairs.join('; ');
  } catch {
    return '';
  }
}
