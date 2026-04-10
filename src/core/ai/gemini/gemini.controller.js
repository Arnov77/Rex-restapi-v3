const geminiService = require('./gemini.service');
const ResponseHandler = require('../../../shared/utils/response');
const logger = require('../../../shared/utils/logger');
const utils = require('../../../utils/utils');

/**
 * Gemini AI Controller
 * Handles AI image generation requests
 */
class GeminiController {
  /**
   * Generate modified image
   */
  async generateImage(req, res, next) {
    try {
      const { image, option } = req.validated;

      logger.info(`[Gemini Controller] Generating image with option: ${option}`);

      const resultBuffer = await geminiService.generateModifiedImage(image, option);

      // Upload to temporary storage
      const uploadedUrl = await utils.uploadToTmpfiles(
        resultBuffer,
        `gemini-output-${option}.png`
      );

      return ResponseHandler.success(
        res,
        {
          url: uploadedUrl,
          option,
          format: 'image/png',
        },
        'Image generated successfully!',
        200
      );

    } catch (error) {
      logger.error(`[Gemini Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new GeminiController();
