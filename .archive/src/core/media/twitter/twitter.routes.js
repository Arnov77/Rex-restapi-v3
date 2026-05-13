const express = require('express');
const router = express.Router();
const twitterController = require('./twitter.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./twitter.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/twitter/download:
 *   post:
 *     summary: Resolve a Twitter / X status URL to direct media URLs
 *     description: |
 *       Three-tier fallback: vxtwitter → fxtwitter → yt-dlp. Returns photo
 *       URLs for image tweets and the muxed mp4 URL for video tweets. The
 *       `source` field in the response identifies which tier resolved the
 *       request.
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 example: https://x.com/elonmusk/status/1349129669258448897
 *     responses:
 *       200: { description: Tweet metadata + media URLs }
 *       400: { description: Invalid URL / no /status/<id> segment }
 *       404: { description: Tweet not found or no downloadable media }
 */
router.post(
  '/download',
  validateRequest(schemas.downloadTwitterSchema),
  asyncHandler(twitterController.download)
);

module.exports = router;
