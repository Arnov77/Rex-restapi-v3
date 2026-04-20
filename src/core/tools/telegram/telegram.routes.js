const express = require('express');
const router = express.Router();
const telegramController = require('./telegram.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { stickerSchema } = require('../../../shared/validators/telegramSchemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @route POST /api/telegram/sticker
 * @desc  Download dan konversi stiker Telegram
 *
 * @body {string}  [fileId]    - Telegram file_id dari stiker (ambil dari pesan Telegram)
 * @body {string}  [url]       - URL langsung ke file stiker (alternatif fileId)
 * @body {string}  [botToken]  - Token bot Telegram (opsional, fallback ke env TELEGRAM_BOT_TOKEN)
 * @body {string}  [format]    - Format output: png | jpg | gif | webp | wa  (default: png)
 *                               "wa" = format stiker WhatsApp (512×512 WebP static,
 *                                      atau GIF untuk animasi — kompatibel baileys/whatsapp-web.js)
 *
 * @returns {Buffer} Gambar sesuai format yang diminta
 *
 * Contoh penggunaan di bot WhatsApp (baileys):
 *   const buffer = await (await fetch('/api/telegram/sticker', {
 *     method: 'POST',
 *     body: JSON.stringify({ fileId: '...', format: 'wa' })
 *   })).arrayBuffer();
 *   await sock.sendMessage(jid, { sticker: Buffer.from(buffer) });
 */
router.post(
  '/sticker',
  validateRequest(stickerSchema),
  asyncHandler((req, res, next) => telegramController.downloadSticker(req, res, next))
);

/**
 * @route POST /api/telegram/sticker-pack
 * @desc  Ambil semua daftar stiker dari sebuah Pack Telegram
 * @body {string} url - Contoh: "https://t.me/addstickers/KOSHAKIEBANIYE"
 */
router.post(
  '/sticker-pack',
  asyncHandler((req, res, next) => telegramController.getStickerPack(req, res, next))
);

module.exports = router;
