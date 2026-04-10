const express = require('express');
const router = express.Router();
const geminiController = require('./gemini.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('../../../shared/validators/geminiSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route POST /api/ai/gemini/generate
 * @desc Generate modified image using Gemini AI
 * @body {string} image - URL of image to modify (required)
 * @body {string} option - Modification option: 'nerd' or 'hitam' (required)
 * @returns {Object} URL of generated image
 */
router.post(
  '/generate',
  validateRequest(schemas.generateImageSchema),
  asyncHandler((req, res, next) => geminiController.generateImage(req, res, next))
);

module.exports = router;
