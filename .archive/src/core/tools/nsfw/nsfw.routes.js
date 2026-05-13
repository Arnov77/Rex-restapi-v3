const express = require('express');
const multer = require('multer');
const router = express.Router();
const nsfwController = require('./nsfw.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');
const { ValidationError } = require('../../../shared/utils/errors');
const { env } = require('../../../../config');
const { detectSchema } = require('./nsfw.schemas');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(env.NSFW_MAX_IMAGE_MB, env.NSFW_MAX_VIDEO_MB) * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype || '';
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
      return cb(new ValidationError('File must be an image, GIF, or video'));
    }
    return cb(null, true);
  },
});

/**
 * @openapi
 * /api/nsfw/detect:
 *   post:
 *     summary: Detect whether an image, GIF, or video is NSFW
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageUrl: { type: string, format: uri, description: HTTPS image URL }
 *               mediaUrl: { type: string, format: uri, description: HTTPS image/GIF/video URL }
 *               threshold: { type: number, minimum: 0, maximum: 1, default: 0.7 }
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image: { type: string, format: binary, description: Image/GIF/video file }
 *               imageUrl: { type: string, format: uri, description: HTTPS image URL alternative }
 *               mediaUrl: { type: string, format: uri, description: HTTPS image/GIF/video URL alternative }
 *               threshold: { type: number, minimum: 0, maximum: 1, default: 0.7 }
 *     responses:
 *       200:
 *         description: Normalized NSFW classification result
 *       400:
 *         description: Missing or invalid image input
 */
router.post(
  '/detect',
  upload.single('image'),
  validateRequest(detectSchema),
  asyncHandler(nsfwController.detect)
);

module.exports = router;
