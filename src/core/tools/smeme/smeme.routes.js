const express = require('express');
const router = express.Router();
const axios = require('axios');
const ResponseHandler = require('../../../shared/utils/response');

const MEMEGEN_BASE_URL = 'https://api.memegen.link';

function encodeMemegenText(text = '') {
  const normalized = String(text).trim().toUpperCase();
  if (!normalized) {
    return '_';
  }

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

// Endpoint: /meme
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return ResponseHandler.error(res, 'Method Not Allowed', 405);
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;

    const { image, top, bottom, format, width, height, font, color, layout } = obj;
    if (!image) return ResponseHandler.error(res, "Parameter 'image' diperlukan (URL gambar)", 400);

    const safeFormat = ['png', 'jpg', 'gif', 'webp'].includes(String(format || '').toLowerCase())
      ? String(format).toLowerCase()
      : 'png';

    const memeUrl = new URL(
      `${MEMEGEN_BASE_URL}/images/custom/${encodeMemegenText(top)}/${encodeMemegenText(bottom)}.${safeFormat}`
    );
    memeUrl.searchParams.set('background', image);

    if (width) memeUrl.searchParams.set('width', width);
    if (height) memeUrl.searchParams.set('height', height);
    if (font) memeUrl.searchParams.set('font', font);
    if (color) memeUrl.searchParams.set('color', color);
    if (layout) memeUrl.searchParams.set('layout', layout);

    const response = await axios.get(memeUrl.toString(), {
      responseType: 'arraybuffer',
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    if (response.status >= 400) {
      const errorMessage = Buffer.from(response.data).toString('utf-8') || 'Gagal membuat meme';
      return ResponseHandler.error(res, errorMessage, response.status);
    }

    res.set('Content-Type', response.headers['content-type'] || `image/${safeFormat}`);
    res.send(Buffer.from(response.data));
  } catch (e) {
    console.error(e);
    return ResponseHandler.error(res, e.message || 'Unknown Error', 500);
  }
});

module.exports = router;
