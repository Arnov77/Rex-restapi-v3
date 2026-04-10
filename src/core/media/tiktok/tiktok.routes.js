const express = require('express');
const router = express.Router();
const tiktokController = require('./tiktok.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('../../../shared/validators/tiktokSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route POST /api/tiktok/download
 * @desc Download TikTok video
 * @body {string} url - TikTok video URL
 */
router.post(
  '/download',
  validateRequest(schemas.downloadTiktokSchema),
  asyncHandler((req, res, next) => tiktokController.downloadVideo(req, res, next))
);

/**
 * @route POST /api/tiktok/audio
 * @desc Download TikTok audio/music
 * @body {string} url - TikTok video URL
 */
router.post(
  '/audio',
  validateRequest(schemas.downloadTiktokMp3Schema),
  asyncHandler((req, res, next) => tiktokController.downloadAudio(req, res, next))
);

module.exports = router;
