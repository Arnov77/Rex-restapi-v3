const telegramService = require('./telegram.service');
const logger = require('../../../shared/utils/logger');
const ResponseHandler = require('../../../shared/utils/response');

/**
 * Telegram Sticker Controller
 * Returns raw image buffer — no JSON wrapper.
 */
class TelegramStickerController {
  async downloadSticker(req, res, next) {
    try {
      const { fileId, url, botToken, format } = req.validated;

      const { buffer, mime, ext, stickerType } = await telegramService.processSticker({
        fileId,
        url,
        botToken,
        format,
      });

      logger.success(`[Telegram Controller] Sticker (${stickerType}) → ${ext} done`);

      res.set('Content-Type', mime);
      res.set('Content-Disposition', `inline; filename="sticker.${ext}"`);
      res.set('X-Sticker-Type', stickerType);
      return res.send(buffer);

    } catch (error) {
      logger.error(`[Telegram Controller] ${error.message}`);
      next(error);
    }
  }

  async getStickerPack(req, res, next) {
    try {
      const { url, packName, botToken } = req.body;
      const target = url || packName;

      if (!target) {
        return ResponseHandler.error(res, 'Sediakan parameter url atau packName', 400);
      }

      const packData = await telegramService.getStickerSet(target, botToken);

      return ResponseHandler.success(
        res,
        packData,
        'Data sticker pack berhasil diambil',
        200
      );

    } catch (error) {
      logger.error(`[Telegram Controller] getStickerPack: ${error.message}`);
      next(error);
    }
  }
}

module.exports = new TelegramStickerController();
