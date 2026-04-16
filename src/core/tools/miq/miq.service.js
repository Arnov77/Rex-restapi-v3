const { MiQ } = require('makeitaquote');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');
const axios = require('axios');

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
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generateQuote(params) {
    const { text, author = 'Unknown', color = false } = params;

    try {
      logger.info(`[MIQ] Generating quote: "${text.substring(0, 30)}..." by ${author}`);

      const miq = new MiQ();
      miq.setText(text);
      
      // Set a default Discord CDN avatar
      miq.setAvatar('https://cdn.discordapp.com/embed/avatars/0.png');
      
      if (author && author !== 'Unknown') {
        miq.setUsername(author);
        miq.setDisplayname(author);
      }
      if (color) {
        miq.setColor(Math.floor(Math.random() * 360));
      }

      // generate() returns a URL string to the generated image
      const imageUrl = await miq.generate();
      logger.info(`[MIQ] Image URL: ${imageUrl}`);

      // Fetch the image from the CDN
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      logger.success('[MIQ] Quote image generated successfully');
      return imageBuffer;

    } catch (error) {
      logger.error(`[MIQ] Error generating quote: ${error.message}`);
      throw new AppError('Failed to generate quote image', 500);
    }
  }

  /**
   * Generate quote image with beta API
   * @param {Object} params - Generation parameters
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async generateQuoteBeta(params) {
    const { text, author = 'Unknown', color = false } = params;

    try {
      logger.info(`[MIQ] Generating quote (beta): "${text.substring(0, 30)}..."`);

      const miq = new MiQ();
      miq.setText(text);
      
      // Set a default Discord CDN avatar
      miq.setAvatar('https://cdn.discordapp.com/embed/avatars/0.png');
      
      if (author && author !== 'Unknown') {
        miq.setUsername(author);
        miq.setDisplayname(author);
      }
      if (color) {
        miq.setColor(Math.floor(Math.random() * 360));
      }

      // generateBeta() also returns a URL string
      const imageUrl = await miq.generateBeta();
      logger.info(`[MIQ Beta] Image URL: ${imageUrl}`);

      // Fetch the image from the CDN
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      logger.success('[MIQ] Quote image (beta) generated successfully');
      return imageBuffer;

    } catch (error) {
      logger.error(`[MIQ] Error generating quote (beta): ${error.message}`);

      throw new AppError('Failed to generate quote image (beta)', 500);
    }
  }
}

module.exports = new MIQService();
