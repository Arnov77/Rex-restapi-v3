const axios = require('axios');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

const MEMEGEN_BASE_URL = 'https://api.memegen.link';

function encodeMemegenText(text = '') {
  const normalized = String(text).trim().toUpperCase();
  if (!normalized) return '_';
  let output = '';
  for (const char of normalized) {
    switch (char) {
      case ' ':
        output += '_';
        break;
      case '_':
        output += '__';
        break;
      case '-':
        output += '--';
        break;
      case '\n':
        output += '~n';
        break;
      case '?':
        output += '~q';
        break;
      case '&':
        output += '~a';
        break;
      case '%':
        output += '~p';
        break;
      case '#':
        output += '~h';
        break;
      case '/':
        output += '~s';
        break;
      case '\\':
        output += '~b';
        break;
      case '<':
        output += '~l';
        break;
      case '>':
        output += '~g';
        break;
      case '"':
        output += "''";
        break;
      default:
        output += char;
    }
  }
  return encodeURIComponent(output);
}

async function generateMeme({ image, top, bottom, format, width, height, font, color, layout }) {
  const memeUrl = new URL(
    `${MEMEGEN_BASE_URL}/images/custom/${encodeMemegenText(top)}/${encodeMemegenText(bottom)}.${format}`
  );
  memeUrl.searchParams.set('background', image);
  if (width) memeUrl.searchParams.set('width', String(width));
  if (height) memeUrl.searchParams.set('height', String(height));
  if (font) memeUrl.searchParams.set('font', font);
  if (color) memeUrl.searchParams.set('color', color);
  if (layout) memeUrl.searchParams.set('layout', layout);

  let response;
  try {
    response = await axios.get(memeUrl.toString(), {
      responseType: 'arraybuffer',
      timeout: 20_000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
  } catch (err) {
    logger.error(`[Smeme] Upstream request failed: ${err.name}: ${err.message}`);
    throw new AppError('Gagal membuat meme (upstream memegen.link)', 502);
  }

  if (response.status >= 400) {
    const errorMessage = Buffer.from(response.data).toString('utf-8') || 'Gagal membuat meme';
    throw new AppError(errorMessage, response.status);
  }

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers['content-type'] || `image/${format}`,
  };
}

module.exports = { generateMeme };
