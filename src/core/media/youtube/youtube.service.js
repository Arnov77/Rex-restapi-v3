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

// Player client controls which YouTube internal client yt-dlp impersonates.
// Override via env if android starts getting throttled too (e.g. "web", "mweb",
// "tv", "android,web"). yt-dlp accepts a comma-separated list.
const YOUTUBE_PLAYER_CLIENT = process.env.YOUTUBE_PLAYER_CLIENT || 'android';

const PLAYER_CLIENT_USER_AGENTS = {
  android: 'com.google.android.youtube/19.29.39 (Linux; U; Android 14) gzip',
  ios: 'com.google.ios.youtube/19.29.1 (iPhone16,2; iOS 17_4_1; Scale/3.00)',
  mweb: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  web: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  tv: 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
};

function pickUserAgent(playerClient) {
  const primary = String(playerClient).split(',')[0].trim().toLowerCase();
  return PLAYER_CLIENT_USER_AGENTS[primary] || PLAYER_CLIENT_USER_AGENTS.android;
}

function getBaseOptions(cookiePath) {
  // IMPORTANT: do NOT push "Cookie:" into addHeader. yt-dlp warns this is a
  // security risk and YouTube's anti-bot escalates ("Failed to extract any
  // player response"). Cookies must come from the Netscape file via opts.cookies.
  const opts = {
    addHeader: [
      `User-Agent: ${pickUserAgent(YOUTUBE_PLAYER_CLIENT)}`,
      'Accept-Language: en-US,en;q=0.9',
    ],
    extractorArgs: `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`,
    geoBypass: true,
    retries: 5,
    fragmentRetries: 5,
    noWarnings: true,
  };
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
      const baseOpts = getBaseOptions(cookiePath);

      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, { ...baseOpts, dumpJson: true, quiet: true });
        videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (e) {
        logger.warn(`[YouTube] Metadata fetch failed: ${e.message}`);
      }

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'audio',
        'mp3'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp3$/, ''));

      await youtubedl(videoUrl, {
        ...baseOpts,
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
      if (this._isBotBlock(error.message)) {
        throw new AppError(
          'YouTube is blocking this server. Set YOUTUBE_COOKIES_B64 with valid browser cookies.',
          403
        );
      }
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
      const baseOpts = getBaseOptions(cookiePath);

      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, { ...baseOpts, dumpJson: true, quiet: true });
        videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (e) {
        logger.warn(`[YouTube] Metadata fetch failed: ${e.message}`);
      }

      const cleanFilename = sanitizeFilename(
        videoMetadata.title || videoInfo?.title || 'video',
        'mp4'
      );
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp4$/, ''));

      const downloadParams = {
        format: 'bestvideo+bestaudio/best',
        mergeOutputFormat: 'mp4',
        output: outputBase,
        quiet: false,
        postprocessorArgs: 'ffmpeg:-c:v copy -c:a aac',
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
      if (this._isBotBlock(error.message)) {
        throw new AppError(
          'YouTube is blocking this server. Set YOUTUBE_COOKIES_B64 with valid browser cookies.',
          403
        );
      }
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

  _isBotBlock(message = '') {
    return [
      'Sign in to confirm',
      'bot',
      'HTTP Error 429',
      'HTTP Error 403',
      'cookies',
      'age-restricted',
      'not available',
    ].some((s) => message.toLowerCase().includes(s.toLowerCase()));
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
