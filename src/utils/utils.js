const { initColorIndex } = require('./color');
const { uploadToTmpfiles } = require('./upload');
const { generateBrat, generateBratVideo } = require('./brat');
const { generateQuoteImage } = require('./quote');
const { promotionDetector } = require('./promotion');
const { getError } = require('./errors');

async function init() {
  await initColorIndex();
}

module.exports = {
  init,
  uploadToTmpfiles,
  generateBrat,
  generateBratVideo,
  generateQuoteImage,
  promotionDetector,
  getError,
};
