const bratService = require('./brat.service');
const ResponseHandler = require('../../../shared/utils/response');
const logger = require('../../../shared/utils/logger');

/**
 * Brat Controller
 * Handles image and video generation requests
 */
class BratController {
  /**
   * Generate static Brat image
   */
  async generateImage(req, res, next) {
    try {
      const params = req.validated;

      const imageBuffer = await bratService.generateImage(params);

      // Send as image, not JSON
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', 'inline; filename="brat.png"');
      return res.send(imageBuffer);

    } catch (error) {
      logger.error(`[Brat Image Controller] ${error.message}`);
      next(error);
    }
  }

  /**
   * Generate animated Brat video (GIF)
   */
  async generateVideo(req, res, next) {
    try {
      const params = req.validated;

      const gifBuffer = await bratService.generateVideo(params);

      res.set('Content-Type', 'image/gif');
      res.set('Content-Disposition', 'inline; filename="brat.gif"');
      return res.send(gifBuffer);

    } catch (error) {
      logger.error(`[Brat Video Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new BratController();
