const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { AppError, ValidationError, NotFoundError } = require('../../../shared/utils/errors');

const SOUNDCLOUD_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?soundcloud\.com\//i;

// scloudplaylistdownloader.app scraper — PHP app (same operator as
// aaplmusicdownloader.com). /api/scinfo.php returns a signed SoundCloud CDN
// URL (dlink_mp3) directly, no further conversion step required.
const SCLOUD_SITE = 'https://scloudplaylistdownloader.app';
const SCLOUD_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function matches(url) {
  return SOUNDCLOUD_HOST_RE.test(url);
}

/**
 * yt-dlp natively supports SoundCloud (track + set URLs). We just dump the
 * extractor's JSON and reshape it into our normalized Track/Album payloads.
 */
async function ytDlpDump(url) {
  try {
    const out = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      quiet: true,
      skipDownload: true,
      flatPlaylist: false,
      // SoundCloud occasionally throttles cloud IPs — keep stretching but
      // bail before request handler timeouts.
      socketTimeout: 30,
    });
    return typeof out === 'string' ? JSON.parse(out) : out;
  } catch (e) {
    if (/HTTP Error 404|not found/i.test(e.message || '')) {
      throw new NotFoundError(`SoundCloud URL not found: ${url}`);
    }
    throw new AppError(`SoundCloud yt-dlp failed: ${e.message || e}`, 502);
  }
}

function trackFromYtDlp(entry, sourceUrl) {
  if (!entry) return null;
  const durationSec = typeof entry.duration === 'number' ? Math.round(entry.duration) : null;
  return {
    id: entry.id ? String(entry.id) : null,
    title: entry.track || entry.title || null,
    artists: entry.artist ? [entry.artist] : entry.uploader ? [entry.uploader] : [],
    album: entry.album || null,
    releaseDate: entry.upload_date
      ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
      : null,
    cover: entry.thumbnail || null,
    durationMs: durationSec ? durationSec * 1000 : null,
    durationSec,
    sourceUrl: entry.webpage_url || sourceUrl || null,
    audio: null, // Stream URL is provider-signed and ephemeral — we don't cache.
  };
}

async function resolve(url) {
  if (!matches(url)) throw new ValidationError(`Not a recognised SoundCloud URL: ${url}`);
  logger.info(`[music:soundcloud] resolving via yt-dlp`);
  const dump = await ytDlpDump(url);

  const isSet =
    dump._type === 'playlist' || dump.extractor === 'soundcloud:set' || Array.isArray(dump.entries);

  if (isSet) {
    const entries = dump.entries || [];
    return {
      type: 'playlist',
      source: 'soundcloud',
      id: dump.id ? String(dump.id) : null,
      name: dump.title || null,
      cover: dump.thumbnail || null,
      sourceUrl: dump.webpage_url || url,
      totalCount: entries.length,
      tracks: entries.map((e) => trackFromYtDlp(e)).filter(Boolean),
    };
  }

  return {
    type: 'track',
    source: 'soundcloud',
    track: trackFromYtDlp(dump, url),
  };
}

/**
 * scloudplaylistdownloader.app — PHPSESSID bootstrap. Their /en1/ route is
 * the entry point.
 */
async function _bootstrapScloudSession() {
  const res = await fetch(`${SCLOUD_SITE}/en1/`, {
    headers: { 'User-Agent': SCLOUD_UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new AppError(`scloud bootstrap HTTP ${res.status}`, 502);
  const setCookies = res.headers.getSetCookie?.() || [];
  const cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!/PHPSESSID=/i.test(cookies)) {
    throw new AppError('scloud bootstrap did not set PHPSESSID cookie', 502);
  }
  return cookies;
}

/**
 * Full scrape flow against scloudplaylistdownloader.app — single POST to
 * /api/scinfo.php returns a signed SoundCloud CDN URL (dlink_mp3). No
 * further conversion needed; the URL is a 128 kbps MP3 direct from
 * cf-media.sndcdn.com.
 */
async function fetchScloudDownload(scUrl) {
  if (!matches(scUrl)) {
    throw new ValidationError(`Not a SoundCloud URL: ${scUrl}`);
  }
  if (/\/sets\//i.test(scUrl)) {
    throw new ValidationError(
      'scloudplaylistdownloader.app /api/scinfo.php only handles single tracks.'
    );
  }

  const cookies = await _bootstrapScloudSession();

  const body = new URLSearchParams({ url: scUrl });
  logger.info(`[music:soundcloud] scloud scinfo.php POST ${scUrl}`);
  const res = await fetch(`${SCLOUD_SITE}/api/scinfo.php`, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'User-Agent': SCLOUD_UA,
      Referer: `${SCLOUD_SITE}/en1/`,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new AppError(`scloudplaylistdownloader scinfo.php HTTP ${res.status}`, 502);
  }
  const payload = await res.json();
  if (payload.error === '403 Forbidden') {
    throw new AppError('scloudplaylistdownloader rate-limited (403)', 502);
  }
  if (!payload.dlink_mp3) {
    throw new AppError(`scloudplaylistdownloader returned no dlink_mp3 for ${scUrl}`, 502);
  }

  return {
    source: 'scloudplaylistdownloader',
    dlinkMp3: payload.dlink_mp3,
    dlinkM4a: payload.dlink_m4a || null,
    track: {
      title: payload.name || null,
      artists: payload.artist ? [payload.artist] : [],
      cover: payload.thumb || null,
      duration: payload.duration || null,
      releaseDate: payload.date || null,
      sourceUrl: payload.url || scUrl,
    },
  };
}

module.exports = {
  matches,
  resolve,
  fetchScloudDownload,
  _trackFromYtDlp: trackFromYtDlp,
};
