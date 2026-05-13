const express = require('express');
const router = express.Router();
const smemeController = require('./smeme.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { smemeSchema } = require('./smeme.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/smeme:
 *   post:
 *     summary: Generate a meme image via memegen.link
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: uri }
 *               top: { type: string }
 *               bottom: { type: string }
 *               format: { type: string, enum: [png, jpg, gif, webp], default: png }
 *               width: { type: integer }
 *               height: { type: integer }
 *               font: { type: string }
 *               color: { type: string }
 *               layout: { type: string }
 *     responses:
 *       200:
 *         description: Meme image bytes
 */
router.post('/', validateRequest(smemeSchema), asyncHandler(smemeController.generate));
router.get('/', validateRequest(smemeSchema, 'query'), asyncHandler(smemeController.generate));

module.exports = router;
