const play = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');
const fs = require('fs-extra');
const path = require('path');
const { randomUUID } = require('crypto');

// Ensure download directory exists (at project root: /downloads)
const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

/**
 * Write cookie from env var (YOUTUBE_COOKIES_B64) to a secure temp file.
 * Returns the tmp path, or null if env var not set.
 * ALWAYS call cleanupCookies(tmpPath) in a finally block after use.
 *
 * @returns {string|null} Path to temp cookie file
 */
function writeCookieToTmp() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return null;

  const tmpPath = `/tmp/ck_${randomUUID()}.txt`;
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  fs.writeFileSync(tmpPath, decoded, { mode: 0o600 }); // hanya owner yg bisa baca
  return tmpPath;
}

/**
 * Delete temp cookie file if it exists.
 * @param {string|null} tmpPath
 */
function cleanupCookies(tmpPath) {
  if (tmpPath && fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
}

/**
 * Sanitize filename from video title
 * @param {string} title - Video title
 * @param {string} ext - File extension (mp3, mp4)
 * @returns {string} Clean filename
 */
function sanitizeFilename(title, ext) {
  let clean = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  clean = clean.substring(0, 50);
  return `${clean}.${ext}`;
}

/**
 * YouTube Service
 * Handles YouTube search and download using yt-dlp
 */
class YouTubeService {
  /**
   * Search YouTube for videos using play-dl
   * @param {string} query - Search query
   * @param {number} limit - Max results (default: 5)
   * @returns {Promise<Object>} Search results with video URLs
   */
  async searchVideos(query, limit = 5) {
    try {
      logger.info(`[YouTube] Searching for: "${query}"`);

      const results = await play.search(query, { limit });

      if (!results || results.length === 0) {
        throw new NotFoundError('No videos found on YouTube');
      }

      const videos = results
        .filter(v => v.type === 'video')
        .slice(0, limit)
        .map(v => ({
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
      return {
        query,
        totalResults: videos.length,
        videos,
        note: 'Use the URL with yt-dlp, ffmpeg, or send to client for download',
      };

    } catch (error) {
      logger.error(`[YouTube Search] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download audio from YouTube
   * @param {string} query - Search query or URL
   * @param {string} baseUrl - Base URL for download link
   * @returns {Promise<Object>} Audio download data
   */
  async downloadMp3(query, baseUrl = 'http://localhost:3000') {
    let cookiePath = null;

    try {
      logger.info(`[YouTube] Fetching MP3 for: ${query}`);

      let videoUrl = query;
      let videoInfo = null;

      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const searchResults = await this.searchVideos(query, 1);
        if (searchResults.videos.length === 0) {
          throw new NotFoundError('Video not found');
        }
        videoInfo = searchResults.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP3 from: ${videoUrl}`);

      // Tulis cookie ke tmp (null kalau env var tidak di-set)
      cookiePath = writeCookieToTmp();
      const cookieOpts = cookiePath ? { cookies: cookiePath } : {};

      // Fetch metadata
      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, {
          dumpJson: true,
          noWarnings: true,
          quiet: true,
          ...cookieOpts,
        });

        videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (metaError) {
        logger.warn(`[YouTube] Could not fetch metadata: ${metaError.message}`);
      }

      const videoTitle = videoMetadata.title || videoInfo?.title || 'audio';
      const cleanFilename = sanitizeFilename(videoTitle, 'mp3');
      const filepath = path.join(DOWNLOAD_DIR, cleanFilename);

      try {
        await youtubedl(videoUrl, {
          extractAudio: true,
          audioFormat: 'mp3',
          audioQuality: '192',
          output: filepath.replace(/\.mp3$/, ''),
          quiet: false,
          noWarnings: true,
          ...cookieOpts,
        });

        const stats = fs.statSync(filepath);
        const fileSize = Math.round(stats.size / 1024) + ' KB';

        logger.success(`[YouTube] MP3 ready: ${cleanFilename}`);

        return {
          title: videoMetadata.title || videoInfo?.title || 'Audio',
          download: `${baseUrl}/download/${cleanFilename}`,
          format: 'audio/mpeg',
          fileSize,
          duration: videoMetadata.duration
            ? this._formatDuration(videoMetadata.duration)
            : (videoInfo?.duration || 'Unknown'),
          author: videoMetadata.uploader || videoMetadata.uploader_id || videoInfo?.author || 'Unknown',
          thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
          status: 'success',
        };

      } catch (downloadError) {
        logger.error(`[YouTube] Download failed: ${downloadError.message}`);
        const errorMsg = downloadError.message.includes('yt-dlp')
          ? 'yt-dlp not found - ensure youtube-dl-exec is properly installed'
          : `Failed to download: ${downloadError.message}`;
        throw new AppError(errorMsg, 502);
      }

    } catch (error) {
      logger.error(`[YouTube MP3] Error: ${error.message}`);
      throw error;
    } finally {
      // Cookie SELALU dihapus, sukses maupun gagal
      cleanupCookies(cookiePath);
    }
  }

  /**
   * Download video from YouTube
   * @param {string} query - Search query or URL
   * @param {string} baseUrl - Base URL for download link
   * @returns {Promise<Object>} Video download data
   */
  async downloadMp4(query, baseUrl = 'http://localhost:3000') {
    let cookiePath = null;

    try {
      logger.info(`[YouTube] Fetching MP4 for: ${query}`);

      let videoUrl = query;
      let videoInfo = null;

      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const searchResults = await this.searchVideos(query, 1);
        if (searchResults.videos.length === 0) {
          throw new NotFoundError('Video not found');
        }
        videoInfo = searchResults.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP4 from: ${videoUrl}`);

      // Tulis cookie ke tmp (null kalau env var tidak di-set)
      cookiePath = writeCookieToTmp();
      const cookieOpts = cookiePath ? { cookies: cookiePath } : {};

      // Fetch metadata
      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, {
          dumpJson: true,
          noWarnings: true,
          quiet: true,
          ...cookieOpts,
        });

        videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (metaError) {
        logger.warn(`[YouTube] Could not fetch metadata: ${metaError.message}`);
      }

      const videoTitle = videoMetadata.title || videoInfo?.title || 'video';
      const cleanFilename = sanitizeFilename(videoTitle, 'mp4');
      const filepath = path.join(DOWNLOAD_DIR, cleanFilename);

      try {
        await youtubedl(videoUrl, {
          // Fallback chain: coba format terbaik dulu, kalau gagal turun ke yg lebih simple
          format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
          mergeOutputFormat: 'mp4',
          output: filepath.replace(/\.mp4$/, ''),
          quiet: false,
          noWarnings: true,
          // Kalau merge butuh re-encode (misal webm → mp4)
          postprocessorArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
          ...cookieOpts,
        });

        const stats = fs.statSync(filepath);
        const fileSize = Math.round(stats.size / (1024 * 1024) * 100) / 100 + ' MB';

        logger.success(`[YouTube] MP4 ready: ${cleanFilename}`);

        return {
          title: videoMetadata.title || videoInfo?.title || 'Video',
          download: `${baseUrl}/download/${cleanFilename}`,
          format: 'video/mp4',
          fileSize,
          duration: videoMetadata.duration
            ? this._formatDuration(videoMetadata.duration)
            : (videoInfo?.duration || 'Unknown'),
          author: videoMetadata.uploader || videoMetadata.uploader_id || videoInfo?.author || 'Unknown',
          thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
          status: 'success',
        };

      } catch (downloadError) {
        const errorMsg = `[YouTube MP4] Download failed: ${downloadError.message}`;
        logger.error(errorMsg);
        throw new AppError(errorMsg, 502);
      }

    } catch (error) {
      logger.error(`[YouTube MP4] Error: ${error.message}`);
      throw error;
    } finally {
      // Cookie SELALU dihapus, sukses maupun gagal
      cleanupCookies(cookiePath);
    }
  }

  /**
   * Helper: Format duration from seconds to human readable format
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  _formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Unknown';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hours > 0) parts.push(`${hours} jam`);
    if (minutes > 0) parts.push(`${minutes} menit`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs} detik`);

    return parts.join(', ');
  }
}

module.exports = new YouTubeService();
