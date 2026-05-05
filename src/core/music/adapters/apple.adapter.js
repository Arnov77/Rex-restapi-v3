const logger = require('../../../shared/utils/logger');
const { AppError, ValidationError, NotFoundError } = require('../../../shared/utils/errors');

const APPLE_HOST_RE = /^https?:\/\/music\.apple\.com\//i;

const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';

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

module.exports = {
  matches,
  resolve,
  _parseAppleUrl: parseAppleUrl,
  _trackFromItunesEntry: trackFromItunesEntry,
};
