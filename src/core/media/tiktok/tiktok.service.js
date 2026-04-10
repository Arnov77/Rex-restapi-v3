const { ttdl } = require('ruhend-scraper');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');

/**
 * TikTok Service
 * Handles TikTok video downloads
 */
class TiktokService {
  /**
   * Download video from TikTok
   * @param {string} url - TikTok video URL
   * @returns {Promise<Object>} TikTok video data
   */
  async downloadVideo(url) {
    try {
      logger.info(`[TikTok] Fetching video from: ${url}`);
      
      const result = await ttdl(url);

      if (!result || !result.video) {
        throw new NotFoundError('Video not found or URL is invalid');
      }

      const formatted = this._formatResponse(result);
      
      logger.success('[TikTok] Video data fetched successfully');
      return formatted;

    } catch (error) {
      logger.error(`[TikTok] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download audio from TikTok
   * @param {string} url - TikTok video URL
   * @returns {Promise<Object>} TikTok audio data
   */
  async downloadAudio(url) {
    try {
      logger.info(`[TikTok] Fetching audio from: ${url}`);
      
      const result = await ttdl(url);

      if (!result || !result.video) {
        throw new NotFoundError('Video not found or URL is invalid');
      }

      return {
        title: result.title,
        author: {
          name: result.author,
          username: result.username,
          avatar: result.avatar,
        },
        audioUrl: result.music || result.video, // Fallback if no separate audio
        format: 'audio/mpeg',
      };

    } catch (error) {
      logger.error(`[TikTok] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper: Format TikTok response
   */
  _formatResponse(result) {
    return {
      region: result.region,
      title: result.title,
      published: result.published,
      author: {
        name: result.author,
        username: result.username,
        avatar: result.avatar,
      },
      stats: {
        like: result.like,
        comment: result.comment,
        share: result.share,
        views: result.views,
        bookmark: result.bookmark,
      },
      media: {
        cover: result.cover,
        video: {
          nowm: result.video,
          wm: result.video_wm,
          hd: result.video_hd,
        },
      },
    };
  }
}

module.exports = new TiktokService();
