const logger = require('../../../shared/utils/logger');
const { AppError, ValidationError, NotFoundError } = require('../../../shared/utils/errors');

const APPLE_HOST_RE = /^https?:\/\/music\.apple\.com\//i;

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// aaplmusicdownloader.com scraper — full pipeline for downloading a single
// track URL as a tagged MP3. The site is a PHP app; we use PHPSESSID for
// statefulness and call their internal /api/* endpoints in the same order a
// real browser does (see their song.php JS).
const AAPL_SITE = 'https://aaplmusicdownloader.com';
const AAPL_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function matches(url) {
  return APPLE_HOST_RE.test(url);
}

/**
 * Pull the relevant numeric IDs out of an Apple Music URL.
 *
 * Examples:
 *   /us/album/lover/1468058165             → { kind: 'album',  id: '1468058165' }
 *   /us/album/lover/1468058165?i=1468058171 → { kind: 'track',  id: '1468058171', albumId: '1468058165' }
 *   /us/song/cruel-summer/1468058171       → { kind: 'track',  id: '1468058171' }
 *   /us/playlist/.../pl.123abc             → { kind: 'playlist', id: 'pl.123abc' }
 */
function parseAppleUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return null;
  }
  if (!/music\.apple\.com$/i.test(parsed.hostname)) return null;

  const segs = parsed.pathname.split('/').filter(Boolean);
  // Layout: <lang>/<kind>/<slug>/<id>
  if (segs.length < 3) return null;
  const kind = segs[1].toLowerCase();
  const idSeg = segs[segs.length - 1];

  if (kind === 'song') {
    return { kind: 'track', id: idSeg };
  }
  if (kind === 'album') {
    const trackId = parsed.searchParams.get('i');
    if (trackId) return { kind: 'track', id: trackId, albumId: idSeg };
    return { kind: 'album', id: idSeg };
  }
  if (kind === 'playlist') {
    return { kind: 'playlist', id: idSeg };
  }
  if (kind === 'artist') {
    return { kind: 'artist', id: idSeg };
  }
  return null;
}

async function itunesLookup(params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${ITUNES_LOOKUP}?${qs}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': ITUNES_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new AppError(`iTunes lookup HTTP ${res.status}`, 502);
  }
  const body = await res.json();
  return body.results || [];
}

function msFromMs(ms) {
  if (typeof ms !== 'number') return null;
  return ms;
}

function trackFromItunesEntry(entry, sourceUrl) {
  return {
    id: entry.trackId ? String(entry.trackId) : null,
    title: entry.trackName || entry.collectionName || null,
    artists: entry.artistName ? [entry.artistName] : [],
    album: entry.collectionName || null,
    releaseDate: entry.releaseDate || null,
    cover: entry.artworkUrl100
      ? entry.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)/, '/600x600bb.jpg')
      : null,
    durationMs: msFromMs(entry.trackTimeMillis),
    durationSec: entry.trackTimeMillis ? Math.round(entry.trackTimeMillis / 1000) : null,
    isrc: entry.isrc || null,
    sourceUrl: entry.trackViewUrl || sourceUrl || null,
    // Apple Music audio is FairPlay-encrypted — we never get a real audio URL
    // from iTunes. Downloads happen via /api/music/apple/download which
    // delegates to the YouTube-search MP3 pipeline.
    audio: null,
  };
}

async function resolveTrack(parsedUrl, sourceUrl) {
  const results = await itunesLookup({ id: parsedUrl.id, entity: 'song', country: 'us' });
  const trackEntry = results.find(
    (e) => e.wrapperType === 'track' && e.kind === 'song' && String(e.trackId) === parsedUrl.id
  );
  if (!trackEntry) {
    throw new NotFoundError(`Apple Music track ${parsedUrl.id} not found in iTunes catalog.`);
  }
  return {
    type: 'track',
    source: 'itunes',
    track: trackFromItunesEntry(trackEntry, sourceUrl),
  };
}

async function resolveAlbum(parsedUrl, sourceUrl) {
  const results = await itunesLookup({ id: parsedUrl.id, entity: 'song', country: 'us' });
  if (!results.length) {
    throw new NotFoundError(`Apple Music album ${parsedUrl.id} not found.`);
  }
  const albumEntry = results.find((e) => e.wrapperType === 'collection');
  const trackEntries = results.filter((e) => e.wrapperType === 'track' && e.kind === 'song');
  return {
    type: 'album',
    source: 'itunes',
    id: String(parsedUrl.id),
    name: albumEntry?.collectionName || null,
    cover: albumEntry?.artworkUrl100
      ? albumEntry.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)/, '/600x600bb.jpg')
      : null,
    artist: albumEntry?.artistName || null,
    releaseDate: albumEntry?.releaseDate || null,
    sourceUrl,
    totalCount: trackEntries.length,
    tracks: trackEntries.map((e) => trackFromItunesEntry(e, null)),
  };
}

async function resolve(url) {
  const parsed = parseAppleUrl(url);
  if (!parsed) throw new ValidationError(`Not a recognised Apple Music URL: ${url}`);

  if (parsed.kind === 'track') {
    logger.info(`[music:apple] resolving track via iTunes (id=${parsed.id})`);
    return resolveTrack(parsed, url);
  }
  if (parsed.kind === 'album') {
    logger.info(`[music:apple] resolving album via iTunes (id=${parsed.id})`);
    return resolveAlbum(parsed, url);
  }
  if (parsed.kind === 'playlist') {
    // iTunes lookup does not expose user-curated Apple Music playlists; that
    // data lives behind the developer-token-gated Apple Music API. We skip
    // playlist support here rather than half-implement it.
    throw new AppError(
      'Apple Music playlist URLs are not supported (requires Apple Music developer API). ' +
        'Convert the playlist to individual track URLs and resolve them one by one.',
      400
    );
  }
  throw new ValidationError(
    `Apple Music ${parsed.kind} URLs are not supported — only track/album.`
  );
}

/**
 * aaplmusicdownloader.com — grab a PHPSESSID by visiting the homepage.
 * Returns the Cookie: header value (PHPSESSID + auth_cookie combined).
 */
async function _bootstrapAaplSession() {
  const res = await fetch(`${AAPL_SITE}/`, {
    headers: { 'User-Agent': AAPL_UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new AppError(`aapl bootstrap HTTP ${res.status}`, 502);
  const setCookies = res.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!/PHPSESSID=/i.test(cookies)) {
    throw new AppError('aapl bootstrap did not set PHPSESSID cookie', 502);
  }
  return cookies;
}

function _aaplHeaders(cookies, referer = `${AAPL_SITE}/`) {
  return {
    Cookie: cookies,
    'User-Agent': AAPL_UA,
    Referer: referer,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/plain, */*',
  };
}

/**
 * Full scrape flow against aaplmusicdownloader.com — returns a URL pointing
 * to a server-side MP3 on their CDN (ID3-tagged).
 *
 * Steps (matches their song.php JS):
 *   1. Bootstrap PHPSESSID via GET /
 *   2. GET /ifCaptcha.php — if "true" we bail (their captcha is image-text,
 *      not Turnstile, so CapSolver doesn't help here)
 *   3. GET /api/applesearch.php?url=<enc> (for ?i= / album URLs) OR
 *      /api/song_url.php?url=<enc> (for /song/ URLs) → metadata JSON
 *   4. POST /api/composer/swd.php → { dlink: <m4a URL>, status: 'success' }
 *   5. POST /api/composer/ffmpeg/saveid3.php → returns filename (plain text)
 *   6. Caller downloads GET /api/composer/ffmpeg/saved/<filename> directly.
 */
async function fetchAaplDownload(appleUrl) {
  if (!matches(appleUrl)) {
    throw new ValidationError(`Not an Apple Music URL: ${appleUrl}`);
  }
  const cookies = await _bootstrapAaplSession();

  const captchaRes = await fetch(`${AAPL_SITE}/ifCaptcha.php`, {
    headers: _aaplHeaders(cookies),
  });
  const captchaText = (await captchaRes.text()).trim();
  if (captchaText === 'true') {
    throw new AppError(
      'aaplmusicdownloader.com has enabled image-text CAPTCHA; scraper path is unavailable.',
      503
    );
  }

  const isSong = /\/song\//i.test(appleUrl);
  const metaPath = isSong ? '/api/song_url.php' : '/api/applesearch.php';
  const metaRes = await fetch(`${AAPL_SITE}${metaPath}?url=${encodeURIComponent(appleUrl)}`, {
    headers: _aaplHeaders(cookies),
  });
  if (!metaRes.ok) {
    throw new AppError(`aaplmusicdownloader ${metaPath} HTTP ${metaRes.status}`, 502);
  }
  const meta = await metaRes.json();
  if (meta.error === '403 Forbidden') {
    throw new AppError('aaplmusicdownloader rate-limited (403)', 502);
  }
  if (!meta.name || !meta.artist) {
    throw new AppError(`aaplmusicdownloader returned empty metadata for ${appleUrl}`, 502);
  }

  logger.info(`[music:apple] aapl swd.php request for "${meta.artist} — ${meta.name}"`);
  const swdBody = new URLSearchParams({
    song_name: meta.name,
    artist_name: meta.artist,
    url: meta.url || appleUrl,
    token: 'none',
    zip_download: 'false',
    quality: 'mp3',
  });
  const swdRes = await fetch(`${AAPL_SITE}/api/composer/swd.php`, {
    method: 'POST',
    headers: {
      ..._aaplHeaders(cookies, `${AAPL_SITE}/song.php`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: swdBody.toString(),
  });
  if (!swdRes.ok) {
    throw new AppError(`aaplmusicdownloader swd.php HTTP ${swdRes.status}`, 502);
  }
  const swd = await swdRes.json();
  if (swd.status !== 'success' || !swd.dlink) {
    throw new AppError(`aaplmusicdownloader swd.php failed: ${swd.comments || swd.status}`, 502);
  }

  const tagBody = new URLSearchParams({
    url: swd.dlink,
    name: meta.name,
    artist: meta.artist,
    album: meta.albumname || '',
    thumb: meta.thumb || '',
  });
  const tagRes = await fetch(`${AAPL_SITE}/api/composer/ffmpeg/saveid3.php`, {
    method: 'POST',
    headers: {
      ..._aaplHeaders(cookies, `${AAPL_SITE}/song.php`),
      Accept: 'text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tagBody.toString(),
  });
  if (!tagRes.ok) {
    throw new AppError(`aaplmusicdownloader saveid3.php HTTP ${tagRes.status}`, 502);
  }
  const filename = (await tagRes.text()).trim();
  if (!filename || filename.length > 200 || /^[<{[]/.test(filename)) {
    throw new AppError(
      `aaplmusicdownloader saveid3.php returned unexpected body: ${filename.slice(0, 80)}`,
      502
    );
  }

  const taggedUrl = `${AAPL_SITE}/api/composer/ffmpeg/saved/${encodeURI(filename)}`;
  return {
    source: 'aaplmusicdownloader',
    taggedUrl,
    rawDlink: swd.dlink,
    track: {
      title: meta.name,
      artists: meta.artist ? [meta.artist] : [],
      album: meta.albumname || null,
      cover: meta.thumb || null,
      duration: meta.duration || null,
      sourceUrl: meta.url || appleUrl,
    },
    upstreamFilename: filename,
  };
}

module.exports = {
  matches,
  resolve,
  fetchAaplDownload,
  _parseAppleUrl: parseAppleUrl,
  _trackFromItunesEntry: trackFromItunesEntry,
};
