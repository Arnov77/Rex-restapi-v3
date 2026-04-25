const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');
const bratPlaywright = require('./brat.playwright');

async function generateImage(params) {
  const { text, preset = 'bratdeluxe', bgColor = null, textColor = null } = params;
  logger.info(`[Brat] Generating image with preset: ${preset}, text: ${text.substring(0, 20)}...`);
  try {
    const imageBuffer = await bratPlaywright.generateBrat(text, preset, bgColor, textColor);
    logger.success('[Brat] Image generated successfully');
    return imageBuffer;
  } catch (error) {
    logger.error(`[Brat] Error generating image: ${error.message}`);
    throw new AppError('Failed to generate Brat image', 500);
  }
}

async function generateVideo(params) {
  const { text, preset = 'bratdeluxe', bgColor = null, textColor = null } = params;
  logger.info(`[Brat] Generating video with preset: ${preset}`);
  try {
    const gifBuffer = await bratPlaywright.generateBratVideo(text, preset, bgColor, textColor);
    logger.success('[Brat] Video/GIF generated successfully');
    return gifBuffer;
  } catch (error) {
    logger.error(`[Brat] Error generating video: ${error.message}`);
    throw new AppError('Failed to generate Brat video', 500);
  }
}

module.exports = { generateImage, generateVideo };
