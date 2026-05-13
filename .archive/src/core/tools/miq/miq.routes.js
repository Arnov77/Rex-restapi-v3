const express = require('express');
const multer = require('multer');
const router = express.Router();
const miqController = require('./miq.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const miqSchemas = require('./miq.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');
const { ValidationError } = require('../../../shared/utils/errors');

// Multer handles the size cap (errorHandler maps LIMIT_FILE_SIZE → 413) and the
// mimetype gate, so the controller doesn't need to re-check these.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new ValidationError('Avatar file must be an image'));
    }
    return cb(null, true);
  },
});

/**
 * @openapi
 * /api/miq/generate:
 *   post:
 *     summary: Generate a "Make it a Quote" image (multipart/form-data)
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, minLength: 5, maxLength: 500 }
 *               author: { type: string, maxLength: 100 }
 *               avatarUrl: { type: string, format: uri, description: HTTPS avatar URL (alternative to uploading a file) }
 *               color: { type: boolean }
 *               avatar: { type: string, format: binary, description: Optional uploaded avatar image (<=5MB) }
 *     responses:
 *       200:
 *         description: PNG quote image
 *         content:
 *           image/png: {}
 */
router.post(
  '/generate',
  upload.single('avatar'),
  validateRequest(miqSchemas.generateQuote),
  asyncHandler(miqController.generateQuote)
);

module.exports = router;
