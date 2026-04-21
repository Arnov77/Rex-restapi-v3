const play = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');
const cookiePath = '/etc/secrets/cookies.txt';
const fs = require('fs-extra');
const path = require('path');

// Ensure download directory exists (at project root: /downloads)
const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

/**
 * Sanitize filename from video title
 * @param {string} title - Video title
 * @param {string} ext - File extension (mp3, mp4)
 * @returns {string} Clean filename
 */
function sanitizeFilename(title, ext) {
  // Remove special characters, keep only alphanumeric, hyphens, and spaces
  let clean = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');   // Remove leading/trailing hyphens
  
  // Limit length to 50 chars
  clean = clean.substring(0, 50);
  
  return `${clean}.${ext}`;
}

/**
 * YouTube Service
 * Handles YouTube search and download using ruhend-scraper
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

      // Format results
      const videos = results
        .filter(v => v.type === 'video') // Only videos, not playlists
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
   * @param {string} baseUrl - Base URL for download link (e.g., http://localhost:3000)
   * @returns {Promise<Object>} Audio download data
   */
  async downloadMp3(query, baseUrl = 'http://localhost:3000') {
    try {
      logger.info(`[YouTube] Fetching MP3 for: ${query}`);
      
      let videoUrl = query;
      let videoInfo = null;

      // If not a URL, search first
      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const searchResults = await this.searchVideos(query, 1);
        if (searchResults.videos.length === 0) {
          throw new NotFoundError('Video not found');
        }
        videoInfo = searchResults.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP3 from: ${videoUrl}`);
      
      // Fetch video metadata first for accurate info
      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, {
          dumpJson: true,
          noWarnings: true,
          quiet: true,
        });
        
        if (typeof metadata === 'string') {
          videoMetadata = JSON.parse(metadata);
        } else {
          videoMetadata = metadata;
        }
      } catch (metaError) {
        logger.warn(`[YouTube] Could not fetch metadata: ${metaError.message}`);
      }
      
      // Generate clean filename from video title
      const videoTitle = videoMetadata.title || videoInfo?.title || 'audio';
      const cleanFilename = sanitizeFilename(videoTitle, 'mp3');
      const filepath = path.join(DOWNLOAD_DIR, cleanFilename);

      try {
        // Download audio using youtube-dl-exec (yt-dlp)
        await youtubedl(videoUrl, {
          extractAudio: true,
          audioFormat: 'mp3',
          audioQuality: '192',
          output: filepath.replace(/.mp3$/, ''),
          quiet: false,
          noWarnings: true,
          cookies: cookiePath,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // Get file size
        const stats = fs.statSync(filepath);
        const fileSize = Math.round(stats.size / 1024) + ' KB'; // Convert to KB
        
        logger.success(`[YouTube] MP3 ready: ${cleanFilename}`);

        return {
          title: videoMetadata.title || videoInfo?.title || 'Audio',
          download: `${baseUrl}/download/${cleanFilename}`,
          format: 'audio/mpeg',
          fileSize: fileSize,
          duration: videoMetadata.duration ? this._formatDuration(videoMetadata.duration) : (videoInfo?.duration || 'Unknown'),
          author: videoMetadata.uploader || videoMetadata.uploader_id || videoInfo?.author || 'Unknown',
          thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
          status: 'success',
        };

      } catch (downloadError) {
        logger.error(`[YouTube] Download failed: ${downloadError.message}`);
        
        // Throw error instead of fallback - REST API must be fully automated
        const errorMsg = downloadError.message.includes('yt-dlp') 
          ? 'yt-dlp not found - ensure youtube-dl-exec is properly installed'
          : `Failed to download: ${downloadError.message}`;
        
        throw new AppError(errorMsg, 502);
      }

    } catch (error) {
      logger.error(`[YouTube MP3] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download video from YouTube
   * @param {string} query - Search query or URL
   * @param {string} baseUrl - Base URL for download link (e.g., http://localhost:3000)
   * @returns {Promise<Object>} Video download data
   */
  async downloadMp4(query, baseUrl = 'http://localhost:3000') {
    try {
      logger.info(`[YouTube] Fetching MP4 for: ${query}`);
      
      let videoUrl = query;
      let videoInfo = null;

      // If not a URL, search first
      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const searchResults = await this.searchVideos(query, 1);
        if (searchResults.videos.length === 0) {
          throw new NotFoundError('Video not found');
        }
        videoInfo = searchResults.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP4 from: ${videoUrl}`);
      
      // Fetch video metadata first for accurate info
      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, {
          dumpJson: true,
          noWarnings: true,
          quiet: true,
        });
        
        if (typeof metadata === 'string') {
          videoMetadata = JSON.parse(metadata);
        } else {
          videoMetadata = metadata;
        }
      } catch (metaError) {
        logger.warn(`[YouTube] Could not fetch metadata: ${metaError.message}`);
      }
      
      // Generate clean filename from video title
      const videoTitle = videoMetadata.title || videoInfo?.title || 'video';
      const cleanFilename = sanitizeFilename(videoTitle, 'mp4');
      const filepath = path.join(DOWNLOAD_DIR, cleanFilename);

      try {
        // Download video using youtube-dl-exec (yt-dlp)
        await youtubedl(videoUrl, {
          format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
          mergeOutputFormat: 'mp4',
          output: filepath.replace(/.mp4$/, ''),
          quiet: false,
          noWarnings: true,
          cookies: cookiePath,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // Get file size
        const stats = fs.statSync(filepath);
        const fileSize = Math.round(stats.size / (1024 * 1024) * 100) / 100 + ' MB'; // Convert to MB
        
        logger.success(`[YouTube] MP4 ready: ${cleanFilename}`);

        return {
          title: videoMetadata.title || videoInfo?.title || 'Video',
          download: `${baseUrl}/download/${cleanFilename}`,
          format: 'video/mp4',
          fileSize: fileSize,
          duration: videoMetadata.duration ? this._formatDuration(videoMetadata.duration) : (videoInfo?.duration || 'Unknown'),
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
    }
  }

  /**
   * Helper: Format duration from seconds to human readable format
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration (e.g., "3 menit, 34 detik")
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
