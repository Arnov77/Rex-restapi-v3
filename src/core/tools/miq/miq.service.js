const { MiQ } = require('makeitaquote');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

async function generateQuote(params) {
  const {
    text,
    author = 'Unknown',
    avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png',
    color = false,
  } = params;

  logger.info(`[MIQ] Generating quote: "${text.substring(0, 30)}..." by ${author}`);

  try {
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

module.exports = { generateQuote };
