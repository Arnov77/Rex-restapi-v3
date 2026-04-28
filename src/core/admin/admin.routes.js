const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');
const validateRequest = require('../../shared/middleware/validateRequest');
const { requireMaster } = require('../../shared/auth/apiKeyAuth');
const { asyncHandler } = require('../../shared/middleware/errorHandler');
const { createKeySchema, updateKeySchema } = require('./admin.schemas');

router.use(requireMaster);

/**
 * @openapi
 * /api/admin/keys:
 *   get:
 *     summary: List all API keys (master only)
 *     tags: [Admin]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200: { description: Array of key records (no plaintext, no hash) }
 *       403: { description: Master API key required }
 */
router.get('/keys', asyncHandler(adminController.listKeys));

/**
 * @openapi
 * /api/admin/keys:
 *   post:
 *     summary: Create a new API key (master only)
 *     description: |
 *       The plaintext key is returned **once** in the `key` field. Store it
 *       immediately — only the SHA-256 hash is persisted.
 *     tags: [Admin]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, maxLength: 80, example: "mobile-app-v1" }
 *               tier:
 *                 type: string
 *                 enum: [user, master]
 *                 default: user
 *               dailyLimit:
 *                 type: integer
 *                 minimum: 0
 *                 nullable: true
 *                 description: Override the default daily quota for this key. Null = use env QUOTA_USER_DAILY.
 *     responses:
 *       201: { description: Key created — plaintext returned once }
 *       400: { description: Invalid body }
 *       403: { description: Master API key required }
 */
router.post('/keys', validateRequest(createKeySchema), asyncHandler(adminController.createKey));

/**
 * @openapi
 * /api/admin/keys/{id}:
 *   patch:
 *     summary: Update an API key (master only)
 *     description: Mutate `name`, `tier`, or `dailyLimit` on an existing key.
 *     tags: [Admin]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 80 }
 *               tier: { type: string, enum: [user, master] }
 *               dailyLimit: { type: integer, minimum: 0, nullable: true }
 *     responses:
 *       200: { description: Key updated }
 *       400: { description: Invalid body }
 *       403: { description: Master API key required }
 *       404: { description: Key not found }
 */
router.patch(
  '/keys/:id',
  validateRequest(updateKeySchema),
  asyncHandler(adminController.updateKey)
);

/**
 * @openapi
 * /api/admin/keys/{id}:
 *   delete:
 *     summary: Revoke an API key (master only)
 *     description: Soft-delete — the record is retained for audit with `revoked=true`.
 *     tags: [Admin]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Key revoked }
 *       403: { description: Master API key required }
 *       404: { description: Key not found }
 */
router.delete('/keys/:id', asyncHandler(adminController.revokeKey));

/**
 * @openapi
 * /api/admin/usage:
 *   get:
 *     summary: Snapshot of today's daily-quota counters (master only)
 *     tags: [Admin]
 *     security:
 *       - apiKey: []
 *     responses:
 *       200:
 *         description: |
 *           Aggregated counters for the current day, sorted by `used` descending.
 *           Resets at local midnight; previous day's snapshot is archived to
 *           `logs/usage-YYYY-MM-DD.json`.
 *       403: { description: Master API key required }
 */
router.get('/usage', asyncHandler(adminController.getUsage));

module.exports = router;
