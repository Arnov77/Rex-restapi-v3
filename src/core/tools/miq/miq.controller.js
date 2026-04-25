const miqService = require('./miq.service');
const { uploadToDiscordWebhook, fetchRemoteImage } = require('../../../shared/utils/upload');

// Avatar resolution: multer `fileFilter` + `limits.fileSize` in the route already
// enforce mimetype & size, so this function only handles the upload/fetch glue.
async function resolveAvatarUrl(req, params) {
  if (req.file) {
    const avatarUrl = await uploadToDiscordWebhook(
      req.file.buffer,
      req.file.originalname || 'avatar.png',
      req.file.mimetype
    );
    return { ...params, avatarUrl };
  }

  if (params.avatarUrl) {
    const remoteImage = await fetchRemoteImage(params.avatarUrl);
    const avatarUrl = await uploadToDiscordWebhook(
      remoteImage.buffer,
      remoteImage.fileName,
      remoteImage.contentType
    );
    return { ...params, avatarUrl };
  }

  return params;
}

async function generateQuote(req, res) {
  const params = await resolveAvatarUrl(req, req.validated);
  const imageBuffer = await miqService.generateQuote(params);
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', 'inline; filename="quote.png"');
  return res.send(imageBuffer);
}

module.exports = { generateQuote };
