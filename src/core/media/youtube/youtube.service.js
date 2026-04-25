const play = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');
const { loadYouTubeCookies, unlinkSilent } = require('../../../shared/utils/cookies');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

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

// player_client spoofing is OPT-IN. yt-dlp's default client negotiation works
// best when paired with a valid Netscape cookies file — hard-coding a single
// client (e.g. android) routinely causes "Requested format is not available"
// because that client doesn't expose the format we asked for. Only set this
// env if you have a specific reason; valid values: android|ios|web|mweb|tv
// (or comma-separated like "android,web").
const YOUTUBE_PLAYER_CLIENT = process.env.YOUTUBE_PLAYER_CLIENT;

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
  // extractorArgs is OPT-IN. Forcing a single client tends to hide the
  // formats we want; let yt-dlp negotiate naturally unless the operator
  // explicitly opts into a specific client via env.
  if (YOUTUBE_PLAYER_CLIENT) {
    opts.extractorArgs = `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`;
  }
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
// even with --dump-single-json, and a stale selector triggers "Requested
// format is not available" before we ever reach the download step.
function getMetadataOptions(cookiePath) {
  const opts = {
    dumpSingleJson: true,
    noWarnings: true,
    quiet: true,
    skipDownload: true,
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
      ({ cookiePath } = prepareCookies());

      // Metadata first, with a separate option set that omits format-related
      // flags. Download options come from getBaseOptions() and DO carry the
      // format selector.
      const videoMetadata = await fetchVideoMetadata(videoUrl, cookiePath);
      const baseOpts = getBaseOptions(cookiePath);

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'audio',
        'mp3'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp3$/, ''));

      // 'ba/b' = bestaudio, fall back to best single-file. Pairs with
      // extractAudio + audioFormat: 'mp3' so ffmpeg transcodes the chosen
      // stream to mp3 regardless of source codec (m4a, opus, webm-audio).
      await youtubedl(videoUrl, {
        ...baseOpts,
        format: 'ba/b',
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '192',
        output: outputBase,
        quiet: false,
      });

      const filepath = `${outputBase}.mp3`;
      if (!fs.existsSync(filepath)) throw new AppError('MP3 file was not created', 502);

      const stats = fs.statSync(filepath);
      logger.success(`[YouTube] MP3 ready: ${cleanFilename}`);
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
      ({ cookiePath } = prepareCookies());

      // Metadata first, with a stripped-down option set (no format selector).
      const videoMetadata = await fetchVideoMetadata(videoUrl, cookiePath);
      const baseOpts = getBaseOptions(cookiePath);

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'video',
        'mp4'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp4$/, ''));

      // 'b/bv*+ba' = best single muxed file first, fall back to merging best
      // video + best audio. The fallback handles videos where YouTube only
      // serves separate AV streams. yt-dlp returns mp4/mkv/webm depending on
      // the source; _findOutputFile already handles all three.
      const downloadParams = {
        format: 'b/bv*+ba',
        mergeOutputFormat: 'mp4',
        output: outputBase,
        quiet: false,
      };

      await youtubedl(videoUrl, { ...baseOpts, ...downloadParams });

      const filepath = this._findOutputFile(outputBase, ['mp4', 'mkv', 'webm']);
      if (!filepath) throw new AppError('Video file was not created', 502);

      const stats = fs.statSync(filepath);
      const actualFilename = path.basename(filepath);
      logger.success(`[YouTube] MP4 ready: ${actualFilename}`);

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

    // Format negotiation failure with yt-dlp — NOT a bot-block, and the cookies
    // we passed worked. The chosen player_client just doesn't expose the
    // requested format. Suggest flipping YOUTUBE_PLAYER_CLIENT.
    if (m.includes('requested format is not available') || m.includes('no video formats found')) {
      return new AppError(
        'Format media tidak tersedia dari YouTube untuk video ini. Coba ubah YOUTUBE_PLAYER_CLIENT (web/mweb/tv) lalu retry.',
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
