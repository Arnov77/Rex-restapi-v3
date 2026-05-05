const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const youtubedl = require('youtube-dl-exec');

const spotifyAdapter = require('./adapters/spotify.adapter');
const appleAdapter = require('./adapters/apple.adapter');
const soundcloudAdapter = require('./adapters/soundcloud.adapter');
const youtubeService = require('../media/youtube/youtube.service');
const logger = require('../../shared/utils/logger');
const { ValidationError, AppError } = require('../../shared/utils/errors');

const DOWNLOAD_DIR = path.join(__dirname, '../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const ADAPTERS = [
  { name: 'spotify', adapter: spotifyAdapter },
  { name: 'apple', adapter: appleAdapter },
  { name: 'soundcloud', adapter: soundcloudAdapter },
];

function pickAdapter(url) {
  return ADAPTERS.find((entry) => entry.adapter.matches(url)) || null;
}

function detectService(url) {
  const picked = pickAdapter(url);
  return picked ? picked.name : null;
}

async function resolve(url) {
  if (!url || typeof url !== 'string') throw new ValidationError('url is required');
  const picked = pickAdapter(url);
  if (!picked) {
    throw new ValidationError(
      'URL host not supported. Accepted: open.spotify.com, music.apple.com, soundcloud.com'
    );
  }
  return picked.adapter.resolve(url);
}

function pickPrimaryArtist(artists) {
  if (!Array.isArray(artists) || !artists.length) return '';
  return artists[0] || '';
}

function buildYouTubeQuery(track) {
  const artist = pickPrimaryArtist(track.artists);
  const title = track.title || '';
  return [artist, title].filter(Boolean).join(' ').trim();
}

function sanitizeFilename(text, ext) {
  let clean = (text || 'audio')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .toLowerCase();
  if (!clean) clean = 'audio';
  clean = clean.slice(0, 60);
  const uid = randomUUID().split('-')[0];
  return `${uid}-${clean}.${ext}`;
}

/**
 * Download a single track URL to MP3 and return metadata + a public download
 * link served from /downloads/<file>.mp3.
 *
 * Per-service helpers (downloadSpotify / downloadApple / downloadSoundcloud)
 * each validate the URL host and refuse URLs belonging to other services.
 *
 * Primary source per service (scrape the downloader sites themselves):
 *   - Spotify      → spotidown.co       (Cloudflare Turnstile + CapSolver)
 *   - Apple Music  → aaplmusicdownloader.com (PHPSESSID + /api/composer/swd.php)
 *   - SoundCloud   → scloudplaylistdownloader.app (PHPSESSID + /api/scinfo.php)
 *
 * Fallback cascade (if the upstream site is down / blocks us):
 *   - Spotify      → (no fallback; Turnstile-protected, always via scrape)
 *   - Apple Music  → iTunes Search API + yt-dlp YouTube
 *   - SoundCloud   → yt-dlp native SoundCloud extractor
 */
async function _downloadViaYoutube(adapterEntry, url, baseUrl, endpointPath) {
  const resolved = await adapterEntry.adapter.resolve(url);
  if (resolved.type !== 'track') {
    throw new ValidationError(
      `Bulk downloads (${resolved.type}) are not supported via ${endpointPath} — ` +
        `call /api/music/resolve first, then iterate per track URL.`
    );
  }
  const track = resolved.track;
  const query = buildYouTubeQuery(track);
  if (!query) {
    throw new AppError('Track metadata missing artist/title — cannot search YouTube.', 502);
  }

  logger.info(`[music:${adapterEntry.name}] yt search for "${query}"`);
  const ytResult = await youtubeService.downloadMp3(query, baseUrl);

  return {
    type: 'track',
    source: resolved.source,
    upstream: 'youtube',
    track,
    download: ytResult.download,
    format: ytResult.format,
    fileSize: ytResult.fileSize,
    durationFromYoutube: ytResult.duration,
    youtubeAuthor: ytResult.author,
    youtubeThumbnail: ytResult.thumbnail,
  };
}

function _requireServiceUrl(url, expectedAdapterName, endpointPath) {
  if (!url || typeof url !== 'string') throw new ValidationError('url is required');
  const picked = pickAdapter(url);
  if (!picked) {
    throw new ValidationError(
      `URL host not supported for ${endpointPath}. Expected a ${expectedAdapterName} URL.`
    );
  }
  if (picked.name !== expectedAdapterName) {
    throw new ValidationError(
      `${endpointPath} only accepts ${expectedAdapterName} URLs (detected: ${picked.name}). ` +
        `Use /api/music/${picked.name}/download instead.`
    );
  }
  return picked;
}

async function downloadSpotify(url, baseUrl = 'http://localhost:3000') {
  const picked = _requireServiceUrl(url, 'spotify', '/api/music/spotify/download');
  return _downloadViaYoutube(picked, url, baseUrl, '/api/music/spotify/download');
}

/**
 * Stream a remote audio URL to DOWNLOAD_DIR and return the local filename +
 * size. Used by the scraper download paths to cache the third-party dlink
 * into our /downloads/ directory so the client-facing URL stays stable.
 */
async function _pipeRemoteToDownloads(remoteUrl, filenameBase, ext) {
  const res = await fetch(remoteUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok || !res.body) {
    throw new AppError(`Remote dlink HTTP ${res.status}`, 502);
  }
  const filename = sanitizeFilename(filenameBase, ext);
  const filepath = path.join(DOWNLOAD_DIR, filename);
  const ws = fs.createWriteStream(filepath);
  const { pipeline } = require('stream/promises');
  const { Readable } = require('stream');
  await pipeline(Readable.fromWeb(res.body), ws);
  const stats = fs.statSync(filepath);
  return {
    filename,
    filepath,
    fileSize: `${Math.round(stats.size / 1024)} KB`,
  };
}

async function downloadApple(url, baseUrl = 'http://localhost:3000') {
  const picked = _requireServiceUrl(url, 'apple', '/api/music/apple/download');
  try {
    const scrape = await appleAdapter.fetchAaplDownload(url);
    const filenameBase =
      [scrape.track.artists[0], scrape.track.title].filter(Boolean).join(' ') ||
      scrape.upstreamFilename ||
      'apple-track';
    const { filename, fileSize } = await _pipeRemoteToDownloads(
      scrape.taggedUrl,
      filenameBase,
      'mp3'
    );
    return {
      type: 'track',
      source: scrape.source, // 'aaplmusicdownloader'
      upstream: scrape.source,
      track: scrape.track,
      download: `${baseUrl}/downloads/${filename}`,
      format: 'audio/mpeg',
      fileSize,
    };
  } catch (err) {
    logger.warn(
      `[music:apple] aaplmusicdownloader scrape failed (${err.message}), falling back to iTunes + yt-dlp YouTube`
    );
    return _downloadViaYoutube(picked, url, baseUrl, '/api/music/apple/download');
  }
}

async function downloadSoundcloud(url, baseUrl = 'http://localhost:3000') {
  _requireServiceUrl(url, 'soundcloud', '/api/music/soundcloud/download');
  if (/\/sets\//i.test(url)) {
    throw new ValidationError(
      'SoundCloud set / playlist URLs are not supported via /api/music/soundcloud/download — ' +
        'call /api/music/resolve first, then iterate per track URL.'
    );
  }
  try {
    const scrape = await soundcloudAdapter.fetchScloudDownload(url);
    const filenameBase =
      [scrape.track.artists[0], scrape.track.title].filter(Boolean).join(' ') || 'soundcloud-track';
    const { filename, fileSize } = await _pipeRemoteToDownloads(
      scrape.dlinkMp3,
      filenameBase,
      'mp3'
    );
    return {
      type: 'track',
      source: scrape.source, // 'scloudplaylistdownloader'
      upstream: scrape.source,
      track: scrape.track,
      download: `${baseUrl}/downloads/${filename}`,
      format: 'audio/mpeg',
      fileSize,
    };
  } catch (err) {
    logger.warn(
      `[music:soundcloud] scloudplaylistdownloader scrape failed (${err.message}), falling back to yt-dlp direct`
    );
    return _downloadSoundCloudDirect(url, baseUrl);
  }
}

async function _downloadSoundCloudDirect(url, baseUrl) {
  // Best-effort title for the output filename — fall back to a generic name
  // if metadata lookup is slow / blocked.
  let titleForName = 'soundcloud-track';
  let trackMeta = null;
  try {
    const resolved = await soundcloudAdapter.resolve(url);
    if (resolved.type === 'track' && resolved.track) {
      trackMeta = resolved.track;
      titleForName = [pickPrimaryArtist(resolved.track.artists), resolved.track.title]
        .filter(Boolean)
        .join(' ');
    }
  } catch (e) {
    logger.warn(`[music:soundcloud] metadata pre-fetch failed: ${e.message}`);
  }

  const filename = sanitizeFilename(titleForName, 'mp3');
  const outBase = path.join(DOWNLOAD_DIR, filename.replace(/\.mp3$/, ''));

  try {
    await youtubedl(url, {
      format: 'bestaudio/best',
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '192',
      output: outBase,
      noWarnings: true,
      noPlaylist: true,
      socketTimeout: 30,
    });
  } catch (e) {
    throw new AppError(`SoundCloud download failed: ${e.message || e}`, 502);
  }

  const filepath = `${outBase}.mp3`;
  if (!fs.existsSync(filepath)) {
    throw new AppError('SoundCloud MP3 file was not created.', 502);
  }
  const stats = fs.statSync(filepath);
  return {
    type: 'track',
    source: 'soundcloud',
    upstream: 'soundcloud',
    track: trackMeta,
    download: `${baseUrl}/downloads/${filename}`,
    format: 'audio/mpeg',
    fileSize: `${Math.round(stats.size / 1024)} KB`,
  };
}

module.exports = {
  resolve,
  downloadSpotify,
  downloadApple,
  downloadSoundcloud,
  detectService,
  // for tests
  _buildYouTubeQuery: buildYouTubeQuery,
};
