const express = require('express');
const router = express.Router();
const gdriveController = require('./gdrive.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { gdriveQuerySchema } = require('./gdrive.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/gdrive:
 *   get:
 *     summary: Resolve a Google Drive link to a direct download URL
 *     tags: [Tools]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string, format: uri }
 *     responses:
 *       200: { description: Direct download metadata }
 *       400: { description: Invalid URL or file ID not found }
 *       502: { description: Upstream Google Drive error }
 */
router.get(
  '/',
  validateRequest(gdriveQuerySchema, 'query'),
  asyncHandler(gdriveController.resolve)
);
router.post('/', validateRequest(gdriveQuerySchema), asyncHandler(gdriveController.resolve));

module.exports = router;
