const youtubeService = require('./youtube.service');
const ResponseHandler = require('../../../shared/utils/response');
const logger = require('../../../shared/utils/logger');

/**
 * YouTube Controller
 * Handles HTTP requests for YouTube operations
 */
class YouTubeController {
  /**
   * Handle MP3 download request
   */
  async getMp3(req, res, next) {
    try {
      const { query } = req.validated;
      
      // Get base URL from request
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      const downloadData = await youtubeService.downloadMp3(query, baseUrl);

      return ResponseHandler.success(
        res,
        downloadData,
        'MP3 download link generated',
        200
      );
    } catch (error) {
      logger.error(`[YouTube MP3 Controller] ${error.message}`);
      next(error);
    }
  }

  /**
   * Handle MP4 download request
   */
  async getMp4(req, res, next) {
    try {
      const { query } = req.validated;
      
      // Get base URL from request
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      const downloadData = await youtubeService.downloadMp4(query, baseUrl);

      return ResponseHandler.success(
        res,
        downloadData,
        'MP4 download link generated',
        200
      );
    } catch (error) {
      logger.error(`[YouTube MP4 Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new YouTubeController();
