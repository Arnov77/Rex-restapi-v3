const express = require('express');
const router = express.Router();
const bratController = require('./brat.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./brat.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/brat/image:
 *   post:
 *     summary: Generate a static Brat image
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 500 }
 *               preset: { type: string, enum: [brat, bratdeluxe, custom], default: bratdeluxe }
 *               bgColor: { type: string }
 *               textColor: { type: string }
 *     responses:
 *       200:
 *         description: PNG image bytes
 *         content:
 *           image/png: {}
 */
router.post(
  '/image',
  validateRequest(schemas.generateBratSchema),
  asyncHandler(bratController.generateImage)
);

/**
 * @openapi
 * /api/brat/video:
 *   post:
 *     summary: Generate an animated Brat GIF
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 500 }
 *               preset: { type: string, enum: [brat, bratdeluxe, custom], default: bratdeluxe }
 *               bgColor: { type: string }
 *               textColor: { type: string }
 *     responses:
 *       200:
 *         description: GIF bytes
 *         content:
 *           image/gif: {}
 */
router.post(
  '/video',
  validateRequest(schemas.generateBratSchema),
  asyncHandler(bratController.generateVideo)
);

module.exports = router;
