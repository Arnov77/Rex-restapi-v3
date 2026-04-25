const express = require('express');
const router = express.Router();
const replicateController = require('./replicate.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { generateImageSchema } = require('./replicate.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/replicate/generate:
 *   post:
 *     summary: Generate an SDXL anime character image
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image, option]
 *             properties:
 *               image:
 *                 type: string
 *                 format: uri
 *                 description: Reference image URL (currently unused by the SDXL pipeline)
 *               option:
 *                 type: string
 *                 enum: [nerd]
 *     responses:
 *       200:
 *         description: PNG image bytes
 *         content:
 *           image/png: {}
 *       503:
 *         description: REPLICATE_API_TOKEN not configured
 */
router.post(
  '/generate',
  validateRequest(generateImageSchema),
  asyncHandler(replicateController.generateImage)
);

module.exports = router;
