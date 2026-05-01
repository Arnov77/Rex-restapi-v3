const ResponseHandler = require('../../../shared/utils/response');
const { fetchRemoteMedia } = require('../../../shared/utils/upload');
const { ValidationError } = require('../../../shared/utils/errors');
const { env } = require('../../../../config');
const nsfwService = require('./nsfw.service');

function enforceMediaSize(buffer, contentType) {
  const isVideo = String(contentType || '').startsWith('video/');
  const maxMb = isVideo ? env.NSFW_MAX_VIDEO_MB : env.NSFW_MAX_IMAGE_MB;
  if (buffer.length > maxMb * 1024 * 1024) {
    throw new ValidationError(`${isVideo ? 'Video' : 'Image/GIF'} file too large (max ${maxMb}MB)`);
  }
}

async function resolveImage(req) {
  if (req.file) {
    enforceMediaSize(req.file.buffer, req.file.mimetype);
    return {
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      source: 'upload',
    };
  }

  const remoteUrl = req.validated.mediaUrl || req.validated.imageUrl;
  if (remoteUrl) {
    const remoteImage = await fetchRemoteMedia(remoteUrl, {
      maxBytes: Math.max(env.NSFW_MAX_IMAGE_MB, env.NSFW_MAX_VIDEO_MB) * 1024 * 1024,
      allowedPrefixes: ['image/', 'video/'],
      label: 'gambar/GIF/video',
    });
    enforceMediaSize(remoteImage.buffer, remoteImage.contentType);
    return {
      buffer: remoteImage.buffer,
      contentType: remoteImage.contentType,
      source: 'url',
    };
  }

  throw new ValidationError('Send imageUrl/mediaUrl or upload image field');
}

async function detect(req, res) {
  const image = await resolveImage(req);
  const result = await nsfwService.detectMedia(image.buffer, {
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
