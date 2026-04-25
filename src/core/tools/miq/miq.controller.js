const miqService = require('./miq.service');
const logger = require('../../../shared/utils/logger');
const { ValidationError } = require('../../../shared/utils/errors');
const { uploadToDiscordWebhook, fetchRemoteImage } = require('../../../shared/utils/upload');

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

async function resolveAvatarUrl(req, params) {
  if (req.file) {
    if (!req.file.mimetype?.startsWith('image/')) {
      throw new ValidationError('Avatar file must be an image');
    }

    if (req.file.size > MAX_AVATAR_SIZE) {
      throw new ValidationError('Avatar file must not exceed 5MB');
    }

    const avatarUrl = await uploadToDiscordWebhook(
      req.file.buffer,
      req.file.originalname || 'avatar.png',
      req.file.mimetype
    );

    return {
      ...params,
      avatarUrl,
    };
  }

  if (params.avatarUrl) {
    const remoteImage = await fetchRemoteImage(params.avatarUrl);
    const avatarUrl = await uploadToDiscordWebhook(
      remoteImage.buffer,
      remoteImage.fileName,
      remoteImage.contentType
    );

    return {
      ...params,
      avatarUrl,
    };
  }

  return params;
}

/**
 * Make it a Quote Controller
 * Handles quote image generation requests
 */
class MIQController {
  /**
   * Generate quote image
   */
  async generateQuote(req, res, next) {
    try {
      const params = await resolveAvatarUrl(req, req.validated);

      const imageBuffer = await miqService.generateQuote(params);

      // Send as image
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', 'inline; filename="quote.png"');
      return res.send(imageBuffer);
    } catch (error) {
      logger.error(`[MIQ Controller] ${error.message}`);
      next(error);
    }
  }
}

module.exports = new MIQController();
