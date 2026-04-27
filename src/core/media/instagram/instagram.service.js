const { igdl } = require('ruhend-scraper');
const logger = require('../../../shared/utils/logger');
const { NotFoundError } = require('../../../shared/utils/errors');

/**
 * Instagram Service
 * Handles Instagram downloads using ruhend-scraper
 */
class InstagramService {
  /**
   * Download from Instagram
   * @param {string} url - Instagram URL
   * @returns {Promise<Object>} Instagram download data
   */
  async download(url) {
    try {
      logger.info(`[Instagram] Fetching from: ${url}`);

      const res = await igdl(url);

      if (!res || !res.data || res.data.length === 0) {
        throw new NotFoundError('No downloadable content found');
      }

      const downloadLinks = res.data.map((media) => ({
        url: media.url,
        type: media.type || 'unknown',
      }));

      logger.success('[Instagram] Content fetched successfully');
      return {
        url,
        downloadLinks,
        count: downloadLinks.length,
      };
    } catch (error) {
      logger.error(`[Instagram] Error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new InstagramService();
