const telegramService = require('./telegram.service');
const logger = require('../../../shared/utils/logger');
const ResponseHandler = require('../../../shared/utils/response');

async function downloadSticker(req, res) {
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
}

async function getStickerPack(req, res) {
  const { url, packName, botToken } = req.validated;
  const target = url || packName;
  const packData = await telegramService.getStickerSet(target, botToken);
  return ResponseHandler.success(res, packData, 'Data sticker pack berhasil diambil', 200);
}

async function downloadStickerPack(req, res) {
  const { url, packName, botToken, publisher, author, stickersPerPack } = req.validated;
  const target = url || packName;
  const { buffer, filename, contentType, parts, totalStickers } =
    await telegramService.buildWAStickerPack({
      packNameOrUrl: target,
      botToken,
      publisher,
      author,
      stickersPerPack,
    });
  logger.success(
    `[Telegram Controller] .wasticker built (${totalStickers} stickers, ${parts} part${parts > 1 ? 's' : ''})`
  );
  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('X-Sticker-Parts', String(parts));
  res.set('X-Sticker-Count', String(totalStickers));
  return res.send(buffer);
}

module.exports = { downloadSticker, getStickerPack, downloadStickerPack };
