const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { AppError, ValidationError, NotFoundError } = require('../../../shared/utils/errors');

const SOUNDCLOUD_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?soundcloud\.com\//i;

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

module.exports = {
  matches,
  resolve,
  _trackFromYtDlp: trackFromYtDlp,
};
