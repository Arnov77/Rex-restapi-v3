const express = require('express');
const router = express.Router();
const screenshotController = require('./screenshot.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { screenshotSchema } = require('./screenshot.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/screenshot:
 *   get:
 *     summary: Capture a full or viewport screenshot of any public URL
 *     description: |
 *       Uses a headless Chromium (Playwright) instance to load the given URL
 *       and return a screenshot as a binary image. Supports PNG, JPEG, and WebP
 *       output, custom viewport dimensions, full-page capture, dark-mode
 *       emulation, and an optional extra wait for dynamic / animated content.
 *     tags: [Tools]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *         example: https://example.com
 *         description: Full http/https URL to screenshot.
 *       - in: query
 *         name: width
 *         schema:
 *           type: integer
 *           minimum: 320
 *           maximum: 3840
 *           default: 1280
 *         description: Viewport width in pixels.
 *       - in: query
 *         name: height
 *         schema:
 *           type: integer
 *           minimum: 240
 *           maximum: 2160
 *           default: 720
 *         description: Viewport height in pixels.
 *       - in: query
 *         name: fullPage
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Capture the entire scrollable page instead of just the viewport.
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [png, jpeg, webp]
 *           default: png
 *         description: Output image format.
 *       - in: query
 *         name: quality
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 85
 *         description: Compression quality for jpeg/webp (ignored for png).
 *       - in: query
 *         name: waitFor
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 10000
 *           default: 0
 *         description: Extra milliseconds to wait after page load (useful for animations).
 *       - in: query
 *         name: darkMode
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Emulate prefers-color-scheme dark before capturing.
 *     responses:
 *       200:
 *         description: Binary image bytes (Content-Type reflects chosen format).
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/webp:
 *             schema:
 *               type: string
 *               format: binary
 *       400: { description: Validation failed }
 *       502: { description: Page load failed }
 */
router.get(
  '/',
  validateRequest(screenshotSchema, 'query'),
  asyncHandler(screenshotController.capture)
);

module.exports = router;
