const express = require('express');
const router = express.Router();
const telegramController = require('./telegram.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const {
  stickerSchema,
  stickerPackSchema,
  stickerPackDownloadSchema,
} = require('./telegram.schemas');
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

/**
 * @openapi
 * /api/telegram/sticker-pack/download:
 *   post:
 *     summary: Build a WhatsApp-compatible `.wasticker` archive from a Telegram pack
 *     tags: [Tools]
 *     description: |
 *       Converts every sticker to 512×512 WebP and bundles them with a
 *       96×96 tray icon at the zip root in a flat layout (`title.txt`,
 *       `author.txt`, `tray.png`, `1.webp` … `N.webp`) — the format read
 *       by Sticker Maker and similar third-party WA importers.
 *
 *       When the source pack exceeds `stickersPerPack` (default 30, WA's
 *       limit) the response is a `.zip` containing multiple `.wasticker`
 *       parts; otherwise a single `.wasticker`. Each part's `title.txt`
 *       carries a `Part N` suffix so importers display them distinctly.
 *       Inspect `X-Sticker-Parts` / `X-Sticker-Count` response headers.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, example: "https://t.me/addstickers/PackName" }
 *               packName: { type: string }
 *               botToken: { type: string }
 *               publisher: { type: string, default: "Rex API", maxLength: 80, description: "Watermark suffix appended to title.txt (e.g. '{pack name} - Rex API')." }
 *               author: { type: string, default: "Converted via Rex REST API", maxLength: 120, description: "Verbatim contents of author.txt." }
 *               stickersPerPack: { type: integer, minimum: 1, maximum: 30, default: 30 }
 *     responses:
 *       200:
 *         description: Binary archive (`.wasticker` or multi-part `.zip`)
 *         content:
 *           application/octet-stream: {}
 *           application/zip: {}
 *       404: { description: Pack not found or empty }
 */
router.post(
  '/sticker-pack/download',
  validateRequest(stickerPackDownloadSchema),
  asyncHandler(telegramController.downloadStickerPack)
);

module.exports = router;
