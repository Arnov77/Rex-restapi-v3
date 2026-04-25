const express = require('express');
const router = express.Router();
const instagramController = require('./instagram.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./instagram.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/instagram/download:
 *   post:
 *     summary: Resolve an Instagram post/reel to direct media URLs
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
 *       200: { description: Instagram media metadata }
 */
router.post(
  '/download',
  validateRequest(schemas.downloadInstagramSchema),
  asyncHandler(instagramController.download)
);

module.exports = router;
