const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

// Ensure download directory exists
const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

/**
 * Sanitize filename from text
 */
function sanitizeFilename(text, ext) {
  let clean = text
    .toLowerCase()
    .substring(0, 30) // Limit to 30 chars
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  
  return `${clean}.${ext}`;
}

/**
 * Brat Image/Video Generation Service
 * Uses browser automation and canvas
 */
class BratService {
  /**
   * Generate static Brat image from text
   * @param {Object} params - Generation parameters
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generateImage(params) {
    const { text, preset = 'bratdeluxe', bgColor = null, textColor = null } = params;

    try {
      logger.info(`[Brat] Generating image with preset: ${preset}, text: ${text.substring(0, 20)}...`);

      const utils = require('../../../utils/utils');
      const imageBuffer = await utils.generateBrat(text, preset, bgColor, textColor);

      // Save to downloads folder (but still return buffer directly)
      try {
        const cleanFilename = sanitizeFilename(text, 'png');
        const filepath = path.join(DOWNLOAD_DIR, cleanFilename);
        fs.writeFileSync(filepath, imageBuffer);
        logger.info(`[Brat] Image also saved to: /download/${cleanFilename}`);
      } catch (saveError) {
        logger.warn(`[Brat] Could not save image to file: ${saveError.message}`);
      }

      logger.success('[Brat] Image generated successfully');
      return imageBuffer;

    } catch (error) {
      logger.error(`[Brat] Error generating image: ${error.message}`);
      throw new AppError('Failed to generate Brat image', 500);
    }
  }

  /**
   * Generate animated Brat video (GIF) from text
   * @param {Object} params - Generation parameters
   * @returns {Promise<Buffer>} GIF buffer
   */
  async generateVideo(params) {
    const { text, preset = 'bratdeluxe', bgColor = null, textColor = null } = params;

    try {
      logger.info(`[Brat] Generating video with preset: ${preset}`);

      const utils = require('../../../utils/utils');
      const gifBuffer = await utils.generateBratVideo(text, preset, bgColor, textColor);

      // Save to downloads folder (but still return buffer directly)
      try {
        const cleanFilename = sanitizeFilename(text, 'gif');
        const filepath = path.join(DOWNLOAD_DIR, cleanFilename);
        fs.writeFileSync(filepath, gifBuffer);
        logger.info(`[Brat] GIF also saved to: /download/${cleanFilename}`);
      } catch (saveError) {
        logger.warn(`[Brat] Could not save GIF to file: ${saveError.message}`);
      }

      logger.success('[Brat] Video/GIF generated successfully');
      return gifBuffer;

    } catch (error) {
      logger.error(`[Brat] Error generating video: ${error.message}`);
      throw new AppError('Failed to generate Brat video', 500);
    }
  }
}

module.exports = new BratService();
