const express = require('express');
const router = express.Router();
const youtubeController = require('./youtube.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('../../../shared/validators/youtubeSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route GET|POST /api/youtube/mp3
 * @desc Download audio from YouTube
 * @query|body {string} query - Search query or video URL
 * @returns {Object} Audio download options with URLs
 */
router.route('/mp3')
  .get(
    validateRequest(schemas.downloadMp3Schema, 'query'),
    asyncHandler((req, res, next) => youtubeController.getMp3(req, res, next))
  )
  .post(
    validateRequest(schemas.downloadMp3Schema, 'body'),
    asyncHandler((req, res, next) => youtubeController.getMp3(req, res, next))
  );

/**
 * @route GET|POST /api/youtube/mp4
 * @desc Download video from YouTube
 * @query|body {string} query - Search query or video URL
 * @returns {Object} Video download options with URLs
 */
router.route('/mp4')
  .get(
    validateRequest(schemas.downloadMp4Schema, 'query'),
    asyncHandler((req, res, next) => youtubeController.getMp4(req, res, next))
  )
  .post(
    validateRequest(schemas.downloadMp4Schema, 'body'),
    asyncHandler((req, res, next) => youtubeController.getMp4(req, res, next))
  );

module.exports = router;
