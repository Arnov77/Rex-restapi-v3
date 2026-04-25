const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

/**
 * Parse Netscape HTTP Cookie File format into an array of cookie objects.
 *
 * Format reference: https://curl.se/docs/http-cookies.html
 * Each non-comment line has 7 tab-separated fields:
 *   domain  includeSubdomains  path  secure  expires  name  value
 *
 * Lines starting with `#HttpOnly_` are HttpOnly cookies (curl convention).
 * Lines starting with `#` (but not `#HttpOnly_`) are comments.
 *
 * @param {string} content Netscape cookie file content
 * @returns {Array<{domain:string,path:string,secure:boolean,httpOnly:boolean,expires:number,name:string,value:string}>}
 */
function parseNetscape(content) {
  if (typeof content !== 'string' || !content) return [];
  const cookies = [];

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine;
    if (!line || !line.trim()) continue;

    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue;
    }

    const parts = line.split('\t');
    if (parts.length < 7) continue;

    const [domain, , cookiePath, secureFlag, expiresStr, name, ...valueParts] = parts;
    if (!name) continue;

    cookies.push({
      domain: domain || '',
      path: cookiePath || '/',
      secure: String(secureFlag).toUpperCase() === 'TRUE',
      httpOnly,
      expires: Number(expiresStr) || 0,
      name,
      value: valueParts.join('\t'),
    });
  }

  return cookies;
}

const DEFAULT_YOUTUBE_DOMAINS = /(^|\.)(youtube\.com|google\.com|youtube-nocookie\.com)$/i;

/**
 * Build a `Cookie:` header value from parsed cookies, filtered by domain.
 *
 * @param {ReturnType<typeof parseNetscape>} cookies
 * @param {RegExp} [domainPattern] Pattern matched against the cookie's domain
 * @returns {string}
 */
function buildCookieHeader(cookies, domainPattern = DEFAULT_YOUTUBE_DOMAINS) {
  if (!Array.isArray(cookies)) return '';
  const seen = new Set();
  const pairs = [];
  for (const c of cookies) {
    if (!c?.name || !domainPattern.test(String(c.domain).replace(/^\./, ''))) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join('; ');
}

/**
 * Decode the YOUTUBE_COOKIES_B64 env var. Returns the raw Netscape file
 * contents, or null if the env var is unset/empty/invalid.
 *
 * @returns {string|null}
 */
function decodeYouTubeCookiesB64() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return null;
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Write Netscape cookie content to a 0600-permissioned tmp file. Caller is
 * responsible for cleanup.
 *
 * @param {string} content
 * @returns {string} absolute file path
 */
function writeNetscapeTmp(content) {
  const filePath = path.join(os.tmpdir(), `yt-cookies-${randomUUID()}.txt`);
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  return filePath;
}

/**
 * Best-effort delete of a cookie tmp file. Swallows ENOENT.
 *
 * @param {string|null|undefined} filePath
 */
function unlinkSilent(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      // best-effort cleanup; never throw
    }
  }
}

/**
 * Load YouTube cookies from YOUTUBE_COOKIES_B64.
 * Returns null when the env var is unset or contains zero parseable cookies.
 *
 * @returns {{cookies:ReturnType<typeof parseNetscape>,header:string,raw:string,write:()=>string}|null}
 */
function loadYouTubeCookies() {
  const raw = decodeYouTubeCookiesB64();
  if (!raw) return null;
  const cookies = parseNetscape(raw);
  if (!cookies.length) return null;
  return {
    raw,
    cookies,
    header: buildCookieHeader(cookies),
    write: () => writeNetscapeTmp(raw),
  };
}

module.exports = {
  parseNetscape,
  buildCookieHeader,
  decodeYouTubeCookiesB64,
  writeNetscapeTmp,
  unlinkSilent,
  loadYouTubeCookies,
  DEFAULT_YOUTUBE_DOMAINS,
};
