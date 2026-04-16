const miqService = require('./miq.service');
const logger = require('../../../shared/utils/logger');

/**
 * Make it a Quote Controller
 * Handles quote image generation requests
 */
class MIQController {
  /**
   * Generate quote image
   */
  async generateQuote(req, res, next) {
    try {
      const params = req.validated;

      const imageBuffer = await miqService.generateQuote(params);

      // Send as image
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', 'inline; filename="quote.png"');
      return res.send(imageBuffer);

    } catch (error) {
      logger.error(`[MIQ Controller] ${error.message}`);
      next(error);
    }
  }

  /**
   * Generate quote image using beta API
   */
  async generateQuoteBeta(req, res, next) {
    try {
      const params = req.validated;

      const imageBuffer = await miqService.generateQuoteBeta(params);

      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', 'inline; filename="quote-beta.png"');
      return res.send(imageBuffer);

    } catch (error) {
      logger.error(`[MIQ Beta Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new MIQController();
