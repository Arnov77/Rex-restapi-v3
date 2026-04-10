const express = require('express');
const router = express.Router();
const bratController = require('./brat.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('../../../shared/validators/bratSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route POST /api/brat/image
 * @desc Generate static Brat image
 * @body {string} text - Text to display (required)
 * @body {string} [preset] - Preset name (default: bratdeluxe) - 'brat', 'bratdeluxe', 'custom'
 * @body {string} [bgColor] - Background color hex/name (for custom preset)
 * @body {string} [textColor] - Text color hex/name (for custom preset)
 * @returns {Buffer} PNG image
 */
router.post(
  '/image',
  validateRequest(schemas.generateBratSchema),
  asyncHandler((req, res, next) => bratController.generateImage(req, res, next))
);

/**
 * @route POST /api/brat/video
 * @desc Generate animated Brat video (GIF)
 * @body {string} text - Text to display (required)
 * @body {string} [preset] - Preset name (default: bratdeluxe)
 * @body {string} [bgColor] - Background color hex/name
 * @body {string} [textColor] - Text color hex/name
 * @returns {Buffer} GIF animation
 */
router.post(
  '/video',
  validateRequest(schemas.generateBratSchema),
  asyncHandler((req, res, next) => bratController.generateVideo(req, res, next))
);

module.exports = router;
