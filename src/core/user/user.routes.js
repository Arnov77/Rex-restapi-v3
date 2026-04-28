const express = require('express');
const router = express.Router();
const userController = require('./user.controller');
const { verifyToken } = require('../../shared/auth/verifyToken');
const { asyncHandler } = require('../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/user/profile:
 *   get:
 *     summary: Get the authenticated user's profile, API key, and live quota
 *     description: |
 *       Returns the user's account, their API key (including plaintext value
 *       so the dashboard can render a 'click to show / click to copy' panel),
 *       and a live snapshot of today's quota usage from the in-memory counter.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Profile + API key + quota }
 *       401: { description: Missing or invalid token }
 *
 * /api/user/regenerate-key:
 *   post:
 *     summary: Revoke the current API key and issue a new one
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: New plaintext API key returned (and stored for future re-display) }
 *       401: { description: Missing or invalid token }
 */
router.get('/profile', verifyToken, asyncHandler(userController.profile));
router.post('/regenerate-key', verifyToken, asyncHandler(userController.regenerateKey));

module.exports = router;
