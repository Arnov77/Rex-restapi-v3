const { MiQ } = require('makeitaquote');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

/**
 * Make it a Quote Service
 * Generates quote images using the MIQ library
 */
class MIQService {
  /**
   * Generate quote image
   * @param {Object} params - Generation parameters
   * @param {string} params.text - Quote text
   * @param {string} params.author - Quote author (optional)
   * @param {string} params.avatarUrl - Avatar profile URL (optional)
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generateQuote(params) {
    const {
      text,
      author = 'Unknown',
      avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png',
      color = false,
    } = params;

    try {
      logger.info(`[MIQ] Generating quote: "${text.substring(0, 30)}..." by ${author}`);

      const miq = new MiQ();
      miq.setText(text);
      miq.setAvatar(avatarUrl);
      
      if (author && author !== 'Unknown') {
        miq.setUsername(author);
        miq.setDisplayname(author);
      }
      miq.setColor(color);

      const imageBuffer = await miq.generate(true);

      logger.success('[MIQ] Quote image generated successfully');
      return imageBuffer;

    } catch (error) {
      logger.error(`[MIQ] Error generating quote: ${error.message}`);
      throw new AppError('Failed to generate quote image', 500);
    }
  }
}

module.exports = new MIQService();
