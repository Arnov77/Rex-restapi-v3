const express = require('express');
const router = express.Router();
const pinterestController = require('./pinterest.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./pinterest.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/pinterest/download:
 *   post:
 *     summary: Resolve a Pinterest pin URL to its direct media URL
 *     description: |
 *       Two-tier fallback: OpenGraph meta scrape → yt-dlp. Image pins are
 *       upgraded from Pinterest's CDN-scaled URL (`/736x/...`) to the
 *       original-resolution path (`/originals/...`). Video pins return the
 *       muxed mp4 URL plus a thumbnail.
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
 *                 example: https://www.pinterest.com/pin/5277724542091034/
 *     responses:
 *       200: { description: Pin metadata + media URL }
 *       400: { description: Invalid Pinterest URL }
 *       404: { description: Pin not found or no downloadable media }
 */
router.post(
  '/download',
  validateRequest(schemas.downloadPinterestSchema),
  asyncHandler(pinterestController.download)
);

module.exports = router;
