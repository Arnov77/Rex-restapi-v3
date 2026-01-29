const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../../config');

// Fungsi bantu untuk ekstrak fileId dari URL Google Drive
function extractFileId(url) {
  const regex = /\/d\/([a-zA-Z0-9_-]+)|id=([a-zA-Z0-9_-]+)/;
  const match = url.match(regex);
  return match ? (match[1] || match[2]) : null;
}

// Endpoint untuk generate link download Google Drive
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.url) {
      return res.status(400).json({ status: 400, message: "Parameter 'url' diperlukan" });
    }

    const fileId = extractFileId(obj.url);
    if (!fileId) {
      return res.status(400).json({ status: 400, message: "Gagal mengekstrak file ID dari URL" });
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

    res.json({
      status: 200,
      creator: config.creator,
      result: {
        data: redirectUrl,
        fileName,
        fileSize,
        mimetype: mimeType
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: "Gagal memproses permintaan" });
  }
});

module.exports = router;
