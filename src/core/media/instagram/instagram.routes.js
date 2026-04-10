const express = require('express');
const router = express.Router();
const instagramController = require('./instagram.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('../../../shared/validators/instagramSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route POST /api/instagram/download
 * @desc Download Instagram content (images/videos)
 * @body {string} url - Instagram post URL
 */
router.post(
  '/download',
  validateRequest(schemas.downloadInstagramSchema),
  asyncHandler((req, res, next) => instagramController.download(req, res, next))
);

module.exports = router;
