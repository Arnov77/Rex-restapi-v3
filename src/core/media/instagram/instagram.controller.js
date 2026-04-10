const instagramService = require('./instagram.service');
const ResponseHandler = require('../../../shared/utils/response');
const logger = require('../../../shared/utils/logger');

/**
 * Instagram Controller
 */
class InstagramController {
  /**
   * Handle Instagram download request
   */
  async download(req, res, next) {
    try {
      const { url } = req.validated;
      
      const data = await instagramService.download(url);

      return ResponseHandler.success(
        res,
        data,
        'Instagram content fetched successfully',
        200
      );
    } catch (error) {
      logger.error(`[Instagram Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new InstagramController();
