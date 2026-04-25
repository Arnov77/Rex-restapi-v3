const axios = require('axios');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

// Accepts both `/d/<id>/...` and `?id=<id>` URL shapes.
function extractFileId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)|id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] || match[2] : null;
}

async function resolveGdriveLink(url) {
  const fileId = extractFileId(url);
  if (!fileId) {
    throw new AppError('Gagal mengekstrak file ID dari URL', 400);
  }

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  let response;
  try {
    response = await axios.get(downloadUrl, {
      maxRedirects: 0,
      timeout: 15_000,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  } catch (err) {
    logger.error(`[GDrive] Resolve failed: ${err.name}: ${err.message}`);
    throw new AppError('Gagal memproses permintaan Google Drive', 502);
  }

  const redirectUrl = response.headers.location || downloadUrl;

  let fileInfo;
  try {
    fileInfo = await axios.head(redirectUrl, { timeout: 15_000 });
  } catch (err) {
    logger.error(`[GDrive] HEAD failed: ${err.name}: ${err.message}`);
    throw new AppError('Gagal mengambil metadata Google Drive', 502);
  }

  const fileName =
    fileInfo.headers['content-disposition']?.match(/filename="(.+?)"/)?.[1] || 'unknown';
  const fileSizeBytes = parseInt(fileInfo.headers['content-length'], 10) || 0;
  const fileSize = `${(fileSizeBytes / 1024).toFixed(2)} KB`;
  const mimeType = fileInfo.headers['content-type'] || 'unknown';

  return { data: redirectUrl, fileName, fileSize, mimetype: mimeType };
}

module.exports = { resolveGdriveLink };
