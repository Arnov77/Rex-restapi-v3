const express = require('express');
const router = express.Router();
const qrcodeController = require('./qrcode.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { generateSchema } = require('./qrcode.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/qrcode/generate:
 *   get:
 *     summary: Generate a QR code image from any text or URL
 *     description: |
 *       Encodes the given `text` into a QR code and returns it as a binary
 *       image (PNG or SVG). Supports custom colors, size, margin (quiet zone),
 *       and error-correction level.
 *
 *       **Error-correction levels:**
 *       - `L` — ~7% data restoration
 *       - `M` — ~15% data restoration (default)
 *       - `Q` — ~25% data restoration
 *       - `H` — ~30% data restoration (use when you add a logo overlay)
 *     tags: [Tools]
 *     parameters:
 *       - in: query
 *         name: text
 *         required: true
 *         schema:
 *           type: string
 *           maxLength: 2953
 *         example: https://example.com
 *         description: Text or URL to encode into the QR code.
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           minimum: 100
 *           maximum: 2000
 *           default: 400
 *         description: Output image size in pixels (PNG only).
 *       - in: query
 *         name: margin
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 10
 *           default: 2
 *         description: Quiet-zone margin width in QR modules.
 *       - in: query
 *         name: darkColor
 *         schema:
 *           type: string
 *           default: '#000000'
 *         example: '#000000'
 *         description: Hex color for the dark QR modules.
 *       - in: query
 *         name: lightColor
 *         schema:
 *           type: string
 *           default: '#ffffff'
 *         example: '#ffffff'
 *         description: Hex color for the light (background) modules.
 *       - in: query
 *         name: errorCorrectionLevel
 *         schema:
 *           type: string
 *           enum: [L, M, Q, H]
 *           default: M
 *         description: QR error-correction level.
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [png, svg]
 *           default: png
 *         description: Output format.
 *     responses:
 *       200:
 *         description: QR code image bytes.
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           image/svg+xml:
 *             schema:
 *               type: string
 *               format: binary
 *       400: { description: Validation failed }
 */
router.get(
  '/generate',
  validateRequest(generateSchema, 'query'),
  asyncHandler(qrcodeController.generate)
);

module.exports = router;
