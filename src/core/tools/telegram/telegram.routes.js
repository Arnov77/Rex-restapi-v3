const express = require('express');
const router = express.Router();
const telegramController = require('./telegram.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { stickerSchema, stickerPackSchema } = require('./telegram.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/telegram/sticker:
 *   post:
 *     summary: Download and convert a Telegram sticker
 *     tags: [Tools]
 *     description: |
 *       Provide either `fileId` (Telegram file_id from a message) or a direct
 *       `url`. Output format defaults to PNG; `wa` produces a 512×512 WebP
 *       compatible with WhatsApp stickers.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileId: { type: string }
 *               url: { type: string, format: uri }
 *               botToken: { type: string, description: Falls back to env TELEGRAM_BOT_TOKEN }
 *               format: { type: string, enum: [png, jpg, jpeg, gif, webp, wa], default: png }
 *     responses:
 *       200:
 *         description: Sticker bytes in the requested format
 */
router.post(
  '/sticker',
  validateRequest(stickerSchema),
  asyncHandler(telegramController.downloadSticker)
);

/**
 * @openapi
 * /api/telegram/sticker-pack:
 *   post:
 *     summary: Fetch metadata for a Telegram sticker pack
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, example: "https://t.me/addstickers/KOSHAKIEBANIYE" }
 *               packName: { type: string }
 *               botToken: { type: string }
 *     responses:
 *       200: { description: Pack metadata with sticker file IDs and emojis }
 *       404: { description: Pack not found }
 */
router.post(
  '/sticker-pack',
  validateRequest(stickerPackSchema),
  asyncHandler(telegramController.getStickerPack)
);

module.exports = router;
