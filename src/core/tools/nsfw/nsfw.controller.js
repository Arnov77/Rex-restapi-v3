const ResponseHandler = require('../../../shared/utils/response');
const { fetchRemoteImage } = require('../../../shared/utils/upload');
const { ValidationError } = require('../../../shared/utils/errors');
const nsfwService = require('./nsfw.service');

async function resolveImage(req) {
  if (req.file) {
    return {
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      source: 'upload',
    };
  }

  if (req.validated.imageUrl) {
    const remoteImage = await fetchRemoteImage(req.validated.imageUrl);
    return {
      buffer: remoteImage.buffer,
      contentType: remoteImage.contentType,
      source: 'url',
    };
  }

  throw new ValidationError('Send imageUrl or upload image field');
}

async function detect(req, res) {
  const image = await resolveImage(req);
  const result = await nsfwService.detectImage(image.buffer, {
    contentType: image.contentType,
    threshold: req.validated.threshold,
  });

  return ResponseHandler.success(
    res,
    { source: image.source, ...result },
    'NSFW detection completed'
  );
}

module.exports = { detect };
