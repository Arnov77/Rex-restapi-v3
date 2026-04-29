const express = require('express');
const router = express.Router();
const userController = require('./user.controller');
const validateRequest = require('../../shared/middleware/validateRequest');
const { verifyToken } = require('../../shared/auth/verifyToken');
const { asyncHandler } = require('../../shared/middleware/errorHandler');
const { revealKeySchema } = require('./user.schemas');

/**
 * @openapi
 * /api/user/profile:
 *   get:
 *     summary: Get the authenticated user's profile and live quota
 *     description: |
 *       Returns the user's account, API key metadata (id, name, tier,
 *       dailyLimit — NO plaintext key), and a live snapshot of today's quota
 *       usage. The plaintext API key is intentionally NOT exposed here:
 *       /profile is polled every 30 seconds for live quota and a stolen JWT
 *       alone must not leak the key. Use /api/user/reveal-key to recover
 *       the plaintext when needed.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Profile + quota (no plaintext key) }
 *       401: { description: Missing or invalid token }
 *
 * /api/user/regenerate-key:
 *   post:
 *     summary: Revoke the current API key and issue a new one
 *     description: |
 *       Returns the plaintext of the new key as a one-time delivery — the
 *       client should cache it locally because /profile no longer exposes it.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: New plaintext API key returned }
 *       401: { description: Missing or invalid token }
 *
 * /api/user/reveal-key:
 *   post:
 *     summary: Re-confirm password to reveal the current API key plaintext
 *     description: |
 *       Recovery path for clients that lost the cached plaintext (e.g. cleared
 *       localStorage). Requires the user's password as proof; a stolen JWT
 *       alone is insufficient.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200: { description: Plaintext API key returned }
 *       401: { description: Missing token or wrong password }
 */
router.get('/profile', verifyToken, asyncHandler(userController.profile));
router.post('/regenerate-key', verifyToken, asyncHandler(userController.regenerateKey));
router.post(
  '/reveal-key',
  verifyToken,
  validateRequest(revealKeySchema),
  asyncHandler(userController.revealKey)
);

module.exports = router;
