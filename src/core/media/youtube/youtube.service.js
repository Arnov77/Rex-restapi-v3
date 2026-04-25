const play = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');
const { loadYouTubeCookies, unlinkSilent } = require('../../../shared/utils/cookies');
const ytdlCore = require('./ytdl-core.helper');
const youtubei = require('./youtubei-helper');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Log the bundled yt-dlp binary version once at module load. This makes it
// trivial to spot when a user's local install has an outdated binary that
// can no longer extract YouTube formats (a common cause of "Requested format
// is not available" even when no format selector is passed).
(async () => {
  try {
    const out = await youtubedl.exec('', ['--version']);
    const stdout = (out && (out.stdout || '')).toString().trim();
    if (stdout) logger.info(`[YouTube] yt-dlp binary version: ${stdout}`);
  } catch (err) {
    logger.warn(
      `[YouTube] Failed to read yt-dlp version (${err.message}). The bundled binary may be missing — run \`npm install\` to trigger postinstall.`
    );
  }
})();

let playDlCookieReady = false;
function ensurePlayDlCookies(cookieData) {
  if (playDlCookieReady || !cookieData?.header || typeof play.setToken !== 'function') return;
  try {
    play.setToken({ youtube: { cookie: cookieData.header } });
    playDlCookieReady = true;
    logger.info(`[YouTube] play-dl cookie configured (${cookieData.cookies.length} entries)`);
  } catch (err) {
    logger.warn(`[YouTube] play-dl cookie injection failed: ${err.message}`);
  }
}

function sanitizeFilename(title, ext) {
  let clean = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .toLowerCase();
  if (!clean) clean = 'media';
  clean = clean.substring(0, 40);
  const uid = randomUUID().split('-')[0];
  return `${uid}-${clean}.${ext}`;
}

// In 2025/2026 YouTube enforces PO Token (Proof of Origin) on most requests.
// Without a PO token, many clients receive a "downgraded" player API response
// with ONLY storyboard images (no real video/audio streams). This chain front-
// loads clients least frequently gated by PO Token enforcement, then falls
// through to mainstream clients in case future YouTube changes flip which
// clients are gated.
const DEFAULT_PLAYER_CLIENT_CHAIN = [
  'mediaconnect',
  'tv_simply',
  'web_safari',
  'mweb',
  'android_vr',
  'android_creator',
  'tv_embedded',
  'tv',
  'web',
  'android',
  'ios',
  'default',
].join(',');
const YOUTUBE_PLAYER_CLIENT = process.env.YOUTUBE_PLAYER_CLIENT || DEFAULT_PLAYER_CLIENT_CHAIN;

// Optional manual PO Token. yt-dlp accepts it via extractor args:
//   youtube:po_token=<client>+<token>
// Operators can extract a PO token from a browser dev tools session and pin
// it here — this is the only reliable way to keep getting full format lists
// when YouTube has enrolled the account in strict PO Token enforcement.
const YOUTUBE_PO_TOKEN = process.env.YOUTUBE_PO_TOKEN || '';

const PLAYER_CLIENT_USER_AGENTS = {
  android: 'com.google.android.youtube/19.29.39 (Linux; U; Android 14) gzip',
  ios: 'com.google.ios.youtube/19.29.1 (iPhone16,2; iOS 17_4_1; Scale/3.00)',
  mweb: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  web: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  tv: 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
};

// Generic desktop Chrome UA used when no player_client is forced.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function pickUserAgent(playerClient) {
  if (!playerClient) return DEFAULT_USER_AGENT;
  const primary = String(playerClient).split(',')[0].trim().toLowerCase();
  return PLAYER_CLIENT_USER_AGENTS[primary] || DEFAULT_USER_AGENT;
}

function getBaseOptions(cookiePath) {
  // IMPORTANT: do NOT push "Cookie:" into addHeader. yt-dlp warns this is a
  // security risk and YouTube's anti-bot escalates ("Failed to extract any
  // player response"). Cookies flow ONLY through the Netscape file at
  // opts.cookies, which is yt-dlp's intended transport.
  const opts = {
    addHeader: [
      `User-Agent: ${pickUserAgent(YOUTUBE_PLAYER_CLIENT)}`,
      'Accept-Language: en-US,en;q=0.9',
    ],
    geoBypass: true,
    retries: 5,
    fragmentRetries: 5,
    noWarnings: true,
  };
  // Always pass a player_client chain. Single-client forcing fails too often;
  // the chain lets yt-dlp probe multiple impersonations until one yields a
  // non-empty format list. PO Token (when provided) is appended in the same
  // youtube: extractor namespace.
  let extractorArgs = `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`;
  if (YOUTUBE_PO_TOKEN) {
    extractorArgs += `;po_token=${YOUTUBE_PO_TOKEN}`;
  }
  opts.extractorArgs = extractorArgs;
  if (cookiePath) {
    opts.cookies = cookiePath;
  } else {
    logger.warn('[YouTube] YOUTUBE_COOKIES_B64 not set — may be blocked on cloud servers');
  }
  return opts;
}

// prepareCookies: write Netscape-format cookies to a fresh tmp file and
// configure play-dl once. The returned cookiePath MUST stay alive on disk
// until every yt-dlp call that uses it has fully resolved. Cleanup happens
// in the caller's finally block via unlinkSilent(cookiePath).
function prepareCookies() {
  const cookieData = loadYouTubeCookies();
  if (!cookieData) return { cookiePath: null };
  ensurePlayDlCookies(cookieData);
  return { cookiePath: cookieData.write() };
}

// Minimal options for the metadata (info-dump) call. Critically, this MUST
// NOT include any format selector — yt-dlp validates the requested format
// even with --dump-single-json. We also force the binary to skip format
// validation so a transient/changed YouTube response can't fail the dump.
function getMetadataOptions(cookiePath) {
  const opts = {
    dumpSingleJson: true,
    noWarnings: true,
    quiet: true,
    skipDownload: true,
    noCheckFormats: true, // --no-check-formats: don't HEAD each format URL
    ignoreNoFormatsError: true, // --ignore-no-formats-error: don't fail when no playable format found
  };
  if (cookiePath) opts.cookies = cookiePath;
  return opts;
}

async function fetchVideoMetadata(videoUrl, cookiePath) {
  try {
    const meta = await youtubedl(videoUrl, getMetadataOptions(cookiePath));
    return typeof meta === 'string' ? JSON.parse(meta) : meta;
  } catch (e) {
    logger.warn(`[YouTube] Metadata fetch failed: ${e.message}`);
    return {};
  }
}

// Run --list-formats to log what yt-dlp can actually see for a video. Useful
// diagnostic when "Requested format is not available" fires \u2014 if the list is
// empty, the issue is upstream (PO token / client / cookies), not our
// selector. Best-effort: never throws.
async function logAvailableFormats(videoUrl, cookiePath) {
  try {
    const opts = {
      listFormats: true,
      noWarnings: true,
      skipDownload: true,
    };
    if (cookiePath) opts.cookies = cookiePath;
    const out = await youtubedl(videoUrl, opts);
    const text = (typeof out === 'string' ? out : out?.stdout || '').toString().trim();
    if (text) {
      logger.warn(`[YouTube] Available formats for ${videoUrl}:\n${text}`);
    } else {
      logger.warn(`[YouTube] yt-dlp returned NO formats for ${videoUrl} (empty list).`);
    }
  } catch (e) {
    logger.warn(`[YouTube] --list-formats probe failed: ${e.message}`);
  }
}

// Run a yt-dlp download. On "Requested format is not available", probe the
// available format list (for the operator to see in logs) and retry once
// with a maximally permissive selector before giving up.
async function downloadWithFallback(videoUrl, primaryOpts, fallbackFormat, cookiePath) {
  try {
    return await youtubedl(videoUrl, primaryOpts);
  } catch (err) {
    const msg = (err && err.message) || '';
    if (!/requested format is not available|no video formats found/i.test(msg)) {
      throw err;
    }
    logger.warn(
      `[YouTube] Primary format selector failed (${msg.split('\n')[0]}). Probing available formats then retrying with format='${fallbackFormat}'.`
    );
    await logAvailableFormats(videoUrl, cookiePath);
    const retryOpts = { ...primaryOpts, format: fallbackFormat };
    return youtubedl(videoUrl, retryOpts);
  }
}

class YouTubeService {
  async searchVideos(query, limit = 5) {
    try {
      logger.info(`[YouTube] Searching for: "${query}"`);
      const results = await play.search(query, { limit });
      if (!results || results.length === 0) throw new NotFoundError('No videos found on YouTube');
      const videos = results
        .filter((v) => v.type === 'video')
        .slice(0, limit)
        .map((v) => ({
          id: v.id,
          title: v.title,
          url: `https://youtube.com/watch?v=${v.id}`,
          thumbnail: v.thumbnail?.url || null,
          duration: v.durationInSec ? this._formatDuration(v.durationInSec) : 'Unknown',
          views: v.views ? v.views.toLocaleString() : 'Unknown',
          author: v.channel?.name || 'Unknown',
          description: v.description || '',
          uploadedAt: v.uploadedAt || 'Unknown',
        }));
      logger.success(`[YouTube] Found ${videos.length} videos`);
      return { query, totalResults: videos.length, videos };
    } catch (error) {
      logger.error(`[YouTube Search] Error: ${error.message}`);
      throw error;
    }
  }

  async downloadMp3(query, baseUrl = 'http://localhost:3000') {
    let cookiePath = null;
    try {
      logger.info(`[YouTube] Fetching MP3 for: ${query}`);

      let videoUrl = query;
      let videoInfo = null;
      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const sr = await this.searchVideos(query, 1);
        if (!sr.videos.length) throw new NotFoundError('Video not found');
        videoInfo = sr.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP3 from: ${videoUrl}`);

      // Tier 1: youtubei.js with auto-generated PO Token. Only path that
      // works on accounts under strict PO Token enforcement.
      const ytiResult = await this._tryYoutubeiMp3(videoUrl, videoInfo, baseUrl);
      if (ytiResult) return ytiResult;

      // Tier 2: @distube/ytdl-core. Different extraction codepath; bypasses
      // some of yt-dlp's failure modes.
      const ytdlResult = await this._tryYtdlCoreMp3(videoUrl, videoInfo, baseUrl);
      if (ytdlResult) return ytdlResult;

      ({ cookiePath } = prepareCookies());

      const videoMetadata = await fetchVideoMetadata(videoUrl, cookiePath);
      const baseOpts = getBaseOptions(cookiePath);

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'audio',
        'mp3'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp3$/, ''));

      await downloadWithFallback(
        videoUrl,
        {
          ...baseOpts,
          format: 'bestaudio/best',
          extractAudio: true,
          audioFormat: 'mp3',
          audioQuality: '192',
          output: outputBase,
          quiet: false,
        },
        'worst',
        cookiePath
      );

      const filepath = `${outputBase}.mp3`;
      if (!fs.existsSync(filepath)) throw new AppError('MP3 file was not created', 502);

      const stats = fs.statSync(filepath);
      logger.success(`[YouTube] MP3 ready (yt-dlp fallback): ${cleanFilename}`);
      return {
        title: videoMetadata.title || videoInfo?.title || 'Audio',
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'audio/mpeg',
        fileSize: Math.round(stats.size / 1024) + ' KB',
        duration: videoMetadata.duration
          ? this._formatDuration(videoMetadata.duration)
          : videoInfo?.duration || 'Unknown',
        author: videoMetadata.uploader || videoInfo?.author || 'Unknown',
        thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (error) {
      logger.error(`[YouTube MP3] Error: ${error.message}`);
      const mapped = this._classifyDownloadError(error);
      if (mapped) throw mapped;
      throw error;
    } finally {
      unlinkSilent(cookiePath);
    }
  }

  /**
   * Attempt MP3 download via youtubei.js (auto PO Token). Returns the API
   * response payload on success, or null when extraction failed (so the
   * caller can fall back to ytdl-core / yt-dlp).
   */
  async _tryYoutubeiMp3(videoUrl, videoInfo, baseUrl) {
    try {
      const cookieData = loadYouTubeCookies();
      const cookies = cookieData?.cookies || [];
      const meta = await youtubei.getVideoMetadata(videoUrl, cookies);

      const titleForName = meta.title || videoInfo?.title || meta.videoId || 'audio';
      const cleanFilename = sanitizeFilename(titleForName, 'mp3');
      const outPath = path.join(DOWNLOAD_DIR, cleanFilename);

      logger.info('[YouTube] MP3 via youtubei.js (primary path, auto PO Token)');
      await youtubei.downloadMp3(videoUrl, outPath, cookies, meta);

      if (!fs.existsSync(outPath)) {
        logger.warn('[YouTube] youtubei.js MP3 finished but file missing — falling back');
        return null;
      }
      const stats = fs.statSync(outPath);
      logger.success(`[YouTube] MP3 ready (youtubei.js): ${cleanFilename}`);
      return {
        title: meta.title || videoInfo?.title || (meta.videoId ? `Video ${meta.videoId}` : 'Audio'),
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'audio/mpeg',
        fileSize: Math.round(stats.size / 1024) + ' KB',
        duration: meta.duration
          ? this._formatDuration(meta.duration)
          : videoInfo?.duration || 'Unknown',
        author: meta.uploader || videoInfo?.author || 'Unknown',
        thumbnail: meta.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (err) {
      logger.warn(`[YouTube] youtubei.js MP3 failed (${err.message}) — falling back to ytdl-core`);
      youtubei.invalidateSession();
      return null;
    }
  }

  async _tryYoutubeiMp4(videoUrl, videoInfo, baseUrl) {
    try {
      const cookieData = loadYouTubeCookies();
      const cookies = cookieData?.cookies || [];
      const meta = await youtubei.getVideoMetadata(videoUrl, cookies);

      const titleForName = meta.title || videoInfo?.title || meta.videoId || 'video';
      const cleanFilename = sanitizeFilename(titleForName, 'mp4');
      const outPath = path.join(DOWNLOAD_DIR, cleanFilename);

      logger.info('[YouTube] MP4 via youtubei.js (primary path, auto PO Token)');
      await youtubei.downloadMp4(videoUrl, outPath, cookies, meta);

      if (!fs.existsSync(outPath)) {
        logger.warn('[YouTube] youtubei.js MP4 finished but file missing — falling back');
        return null;
      }
      const stats = fs.statSync(outPath);
      logger.success(`[YouTube] MP4 ready (youtubei.js): ${cleanFilename}`);
      return {
        title: meta.title || videoInfo?.title || (meta.videoId ? `Video ${meta.videoId}` : 'Video'),
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'video/mp4',
        fileSize: Math.round((stats.size / (1024 * 1024)) * 100) / 100 + ' MB',
        duration: meta.duration
          ? this._formatDuration(meta.duration)
          : videoInfo?.duration || 'Unknown',
        author: meta.uploader || videoInfo?.author || 'Unknown',
        thumbnail: meta.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (err) {
      logger.warn(`[YouTube] youtubei.js MP4 failed (${err.message}) — falling back to ytdl-core`);
      youtubei.invalidateSession();
      return null;
    }
  }

  /**
   * Attempt MP3 download via ytdl-core. Returns the API response payload on
   * success, or null when ytdl-core couldn't produce a file (so the caller
   * can fall back to yt-dlp).
   */
  async _tryYtdlCoreMp3(videoUrl, videoInfo, baseUrl) {
    try {
      const cookieData = loadYouTubeCookies();
      const agent = ytdlCore.getYtdlAgent(cookieData?.cookies || []);
      const meta = await ytdlCore.getVideoMetadata(videoUrl, agent);

      const cleanFilename = sanitizeFilename(meta.title || videoInfo?.title || 'audio', 'mp3');
      const outPath = path.join(DOWNLOAD_DIR, cleanFilename);

      logger.info('[YouTube] MP3 via ytdl-core (primary path)');
      await ytdlCore.downloadMp3(videoUrl, outPath, agent, meta);

      if (!fs.existsSync(outPath)) {
        logger.warn('[YouTube] ytdl-core MP3 finished but file missing — falling back to yt-dlp');
        return null;
      }
      const stats = fs.statSync(outPath);
      logger.success(`[YouTube] MP3 ready (ytdl-core): ${cleanFilename}`);
      return {
        title: meta.title || videoInfo?.title || 'Audio',
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'audio/mpeg',
        fileSize: Math.round(stats.size / 1024) + ' KB',
        duration: meta.duration
          ? this._formatDuration(meta.duration)
          : videoInfo?.duration || 'Unknown',
        author: meta.uploader || videoInfo?.author || 'Unknown',
        thumbnail: meta.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (err) {
      logger.warn(`[YouTube] ytdl-core MP3 failed (${err.message}) — falling back to yt-dlp`);
      return null;
    }
  }

  async downloadMp4(query, baseUrl = 'http://localhost:3000') {
    let cookiePath = null;
    try {
      logger.info(`[YouTube] Fetching MP4 for: ${query}`);

      let videoUrl = query;
      let videoInfo = null;
      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const sr = await this.searchVideos(query, 1);
        if (!sr.videos.length) throw new NotFoundError('Video not found');
        videoInfo = sr.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP4 from: ${videoUrl}`);

      const ytiResult = await this._tryYoutubeiMp4(videoUrl, videoInfo, baseUrl);
      if (ytiResult) return ytiResult;

      const ytdlResult = await this._tryYtdlCoreMp4(videoUrl, videoInfo, baseUrl);
      if (ytdlResult) return ytdlResult;

      ({ cookiePath } = prepareCookies());

      const videoMetadata = await fetchVideoMetadata(videoUrl, cookiePath);
      const baseOpts = getBaseOptions(cookiePath);

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'video',
        'mp4'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp4$/, ''));

      const downloadParams = {
        format: 'best/bestvideo+bestaudio',
        mergeOutputFormat: 'mp4',
        output: outputBase,
        quiet: false,
      };

      await downloadWithFallback(videoUrl, { ...baseOpts, ...downloadParams }, 'worst', cookiePath);

      const filepath = this._findOutputFile(outputBase, ['mp4', 'mkv', 'webm']);
      if (!filepath) throw new AppError('Video file was not created', 502);

      const stats = fs.statSync(filepath);
      const actualFilename = path.basename(filepath);
      logger.success(`[YouTube] MP4 ready (yt-dlp fallback): ${actualFilename}`);

      return {
        title: videoMetadata.title || videoInfo?.title || 'Video',
        download: `${baseUrl}/download/${actualFilename}`,
        format: 'video/mp4',
        fileSize: Math.round((stats.size / (1024 * 1024)) * 100) / 100 + ' MB',
        duration: videoMetadata.duration
          ? this._formatDuration(videoMetadata.duration)
          : videoInfo?.duration || 'Unknown',
        author: videoMetadata.uploader || videoInfo?.author || 'Unknown',
        thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (error) {
      logger.error(`[YouTube MP4] Error: ${error.message}`);
      const mapped = this._classifyDownloadError(error);
      if (mapped) throw mapped;
      throw new AppError(`Download failed: ${error.message}`, 502);
    } finally {
      unlinkSilent(cookiePath);
    }
  }

  async _tryYtdlCoreMp4(videoUrl, videoInfo, baseUrl) {
    try {
      const cookieData = loadYouTubeCookies();
      const agent = ytdlCore.getYtdlAgent(cookieData?.cookies || []);
      const meta = await ytdlCore.getVideoMetadata(videoUrl, agent);

      const cleanFilename = sanitizeFilename(meta.title || videoInfo?.title || 'video', 'mp4');
      const outPath = path.join(DOWNLOAD_DIR, cleanFilename);

      logger.info('[YouTube] MP4 via ytdl-core (primary path)');
      await ytdlCore.downloadMp4(videoUrl, outPath, agent, meta);

      if (!fs.existsSync(outPath)) {
        logger.warn('[YouTube] ytdl-core MP4 finished but file missing — falling back to yt-dlp');
        return null;
      }
      const stats = fs.statSync(outPath);
      logger.success(`[YouTube] MP4 ready (ytdl-core): ${cleanFilename}`);
      return {
        title: meta.title || videoInfo?.title || 'Video',
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'video/mp4',
        fileSize: Math.round((stats.size / (1024 * 1024)) * 100) / 100 + ' MB',
        duration: meta.duration
          ? this._formatDuration(meta.duration)
          : videoInfo?.duration || 'Unknown',
        author: meta.uploader || videoInfo?.author || 'Unknown',
        thumbnail: meta.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (err) {
      logger.warn(`[YouTube] ytdl-core MP4 failed (${err.message}) — falling back to yt-dlp`);
      return null;
    }
  }

  _findOutputFile(base, exts = ['mp4', 'mkv', 'webm']) {
    for (const ext of exts) {
      const f = `${base}.${ext}`;
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  // Pass an Error or a string. Returns an AppError with the right HTTP code +
  // user-facing message, or null if the error doesn't match any known pattern
  // (caller should rethrow as-is in that case).
  _classifyDownloadError(input) {
    const message = (input && input.message) || String(input || '');
    const m = message.toLowerCase();

    // Format negotiation failure. After our retry chain + 'worst' fallback
    // still couldn't pick a usable format, the most likely root cause is
    // YouTube serving a "downgraded" player response (storyboards only) due
    // to PO Token enforcement on this account. Cookies alone are insufficient.
    if (m.includes('requested format is not available') || m.includes('no video formats found')) {
      return new AppError(
        'YouTube tidak mengembalikan format media yang bisa di-download. ' +
          'Penyebab paling umum: PO Token enforcement (cookies saja tidak cukup). ' +
          'Solusi: set YOUTUBE_PO_TOKEN di .env, atau regenerate cookies dari sesi browser yang baru saja menonton video.',
        502
      );
    }

    // Video genuinely unavailable.
    if (
      m.includes('video unavailable') ||
      m.includes('this video is no longer available') ||
      m.includes('private video') ||
      m.includes('removed by the user')
    ) {
      return new AppError('Video tidak tersedia atau sudah dihapus.', 404);
    }

    // Age-gated content — needs cookies from a logged-in adult account.
    if (m.includes('age-restricted') || m.includes('confirm your age')) {
      return new AppError(
        'Video age-restricted. Cookies harus dari akun yang sudah login dewasa.',
        403
      );
    }

    // Genuine anti-bot block — server IP flagged.
    if (
      m.includes('sign in to confirm') ||
      m.includes("confirm you're not a bot") ||
      m.includes('http error 429') ||
      m.includes('http error 403')
    ) {
      return new AppError(
        'YouTube is blocking this server. Set YOUTUBE_COOKIES_B64 with valid browser cookies.',
        403
      );
    }

    return null;
  }

  _formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (s > 0 || !parts.length) parts.push(`${s} detik`);
    return parts.join(', ');
  }
}

module.exports = new YouTubeService();
