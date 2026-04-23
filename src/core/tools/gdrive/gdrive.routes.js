const express = require('express');
const router = express.Router();
const axios = require('axios');
const ResponseHandler = require('../../../shared/utils/response');

// Fungsi bantu untuk ekstrak fileId dari URL Google Drive
function extractFileId(url) {
  const regex = /\/d\/([a-zA-Z0-9_-]+)|id=([a-zA-Z0-9_-]+)/;
  const match = url.match(regex);
  return match ? (match[1] || match[2]) : null;
}

// Endpoint untuk generate link download Google Drive
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return ResponseHandler.error(res, 'Method Not Allowed', 405);
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.url) {
      return ResponseHandler.error(res, "Parameter 'url' diperlukan", 400);
    }

    const fileId = extractFileId(obj.url);
    if (!fileId) {
      return ResponseHandler.error(res, 'Gagal mengekstrak file ID dari URL', 400);
    }

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const response = await axios.get(downloadUrl, {
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
    });

    let redirectUrl = response.headers.location || downloadUrl;

    const fileInfo = await axios.head(redirectUrl);

    const fileName = fileInfo.headers['content-disposition']
      ?.match(/filename="(.+?)"/)?.[1] || 'unknown';

    const fileSizeBytes = parseInt(fileInfo.headers['content-length']) || 0;
    const fileSize = (fileSizeBytes / 1024).toFixed(2) + ' KB';

    const mimeType = fileInfo.headers['content-type'] || 'unknown';

    return ResponseHandler.success(
      res,
      {
        data: redirectUrl,
        fileName,
        fileSize,
        mimetype: mimeType,
      },
      'Google Drive link fetched successfully',
      200
    );
  } catch (e) {
    console.error(e);
    return ResponseHandler.error(res, 'Gagal memproses permintaan', 500);
  }
});

module.exports = router;
