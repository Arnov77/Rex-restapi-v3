const tiktokService = require('./tiktok.service');
const ResponseHandler = require('../../../shared/utils/response');
const logger = require('../../../shared/utils/logger');

/**
 * TikTok Controller
 */
class TiktokController {
  /**
   * Handle TikTok video download request
   */
  async downloadVideo(req, res, next) {
    try {
      const { url } = req.validated;
      
      const videoData = await tiktokService.downloadVideo(url);

      return ResponseHandler.success(
        res,
        videoData,
        'TikTok video data fetched successfully',
        200
      );
    } catch (error) {
      logger.error(`[TikTok Video Controller] ${error.message}`);
      next(error);
    }
  }

  /**
   * Handle TikTok audio download request
   */
  async downloadAudio(req, res, next) {
    try {
      const { url } = req.validated;
      
      const audioData = await tiktokService.downloadAudio(url);

      return ResponseHandler.success(
        res,
        audioData,
        'TikTok audio data fetched successfully',
        200
      );
    } catch (error) {
      logger.error(`[TikTok Audio Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new TiktokController();
