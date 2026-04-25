const express = require('express');
const router = express.Router();
const promosiController = require('./promosi.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { analyzePromosiSchema } = require('./promosi.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/promosi:
 *   post:
 *     summary: Analyze whether a text is promotional using Gemini
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, maxLength: 5000 }
 *               threshold: { type: integer, minimum: 0, maximum: 100, default: 70 }
 *     responses:
 *       200:
 *         description: Promotion analysis result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     percentage: { type: integer }
 *                     isPromotion: { type: boolean }
 *                     reason: { type: string }
 *       503: { description: GEMINI_API_KEY not configured }
 */
router.post('/', validateRequest(analyzePromosiSchema), asyncHandler(promosiController.analyze));
router.get(
  '/',
  validateRequest(analyzePromosiSchema, 'query'),
  asyncHandler(promosiController.analyze)
);

module.exports = router;
