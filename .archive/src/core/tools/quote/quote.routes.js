const express = require('express');
const router = express.Router();
const quoteController = require('./quote.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { generateQuoteSchema } = require('./quote.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

// Body-only schema; routing via POST keeps validation straightforward. Legacy
// GET callers should migrate — the previous `router.all('/')` dual-mode was
// ambiguous because query params don't support typed coercion well here.

/**
 * @openapi
 * /api/quote:
 *   post:
 *     summary: Render a chat-bubble-style quote image as PNG
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, message]
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               message: { type: string, maxLength: 1000 }
 *               avatarUrl:
 *                 type: string
 *                 format: uri
 *                 description: Optional HTTPS avatar URL
 *     responses:
 *       200:
 *         description: PNG image bytes
 *         content:
 *           image/png: {}
 */
router.post('/', validateRequest(generateQuoteSchema), asyncHandler(quoteController.generate));
// Back-compat GET; kept so existing callers don't break. New integrations
// should use POST.
router.get(
  '/',
  validateRequest(generateQuoteSchema, 'query'),
  asyncHandler(quoteController.generate)
);

module.exports = router;
