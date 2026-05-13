const express = require('express');
const router = express.Router();
const tiktokController = require('./tiktok.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./tiktok.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/tiktok/download:
 *   post:
 *     summary: Resolve a TikTok video URL to direct download links
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri }
 *     responses:
 *       200: { description: TikTok video metadata with direct URLs }
 */
router.post(
  '/download',
  validateRequest(schemas.downloadTiktokSchema),
  asyncHandler(tiktokController.downloadVideo)
);

/**
 * @openapi
 * /api/tiktok/audio:
 *   post:
 *     summary: Resolve a TikTok video URL to its audio/music track
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url: { type: string, format: uri }
 *     responses:
 *       200: { description: TikTok audio metadata }
 */
router.post(
  '/audio',
  validateRequest(schemas.downloadTiktokMp3Schema),
  asyncHandler(tiktokController.downloadAudio)
);

module.exports = router;
