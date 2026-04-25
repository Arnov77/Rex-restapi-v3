const { generateQuoteImage } = require('./quote.playwright');

async function generateQuote({ name, message, avatarUrl }) {
  return generateQuoteImage(name, message, avatarUrl);
}

module.exports = { generateQuote };
