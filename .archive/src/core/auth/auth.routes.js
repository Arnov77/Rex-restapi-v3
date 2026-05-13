const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const validateRequest = require('../../shared/middleware/validateRequest');
const { registerSchema, loginSchema } = require('./auth.schemas');
const { asyncHandler } = require('../../shared/middleware/errorHandler');
const { loginLimiter } = require('../../shared/middleware/loginLimiter');
const { registerLimiter } = require('../../shared/middleware/registerLimiter');

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new user account
 *     description: |
 *       Creates a user record (bcrypt-hashed password) and provisions a
 *       tier=user API key with the configured daily quota. Returns the
 *       plaintext API key alongside a JWT for immediate use.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password]
 *             properties:
 *               username: { type: string, pattern: '^[a-zA-Z0-9_]{3,32}$' }
 *               email:    { type: string, format: email }
 *               password: { type: string, minLength: 8, maxLength: 200 }
 *     responses:
 *       201: { description: Registered }
 *       409: { description: Username or email already taken }
 *
 * /api/auth/login:
 *   post:
 *     summary: Exchange credentials for a JWT
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or username
 *               password: { type: string }
 *     responses:
 *       200: { description: Authenticated, returns JWT }
 *       401: { description: Invalid credentials }
 */
router.post(
  '/register',
  registerLimiter,
  validateRequest(registerSchema),
  asyncHandler(authController.register)
);
router.post(
  '/login',
  ...loginLimiter,
  validateRequest(loginSchema),
  asyncHandler(authController.login)
);

module.exports = router;
