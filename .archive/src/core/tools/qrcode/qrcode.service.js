const QRCode = require('qrcode');
const logger = require('../../../shared/utils/logger');

/**
 * Generates a QR code from the given text.
 * @param {object} opts
 * @param {string}  opts.text                 - Content to encode.
 * @param {number}  opts.size                 - Output image size in pixels (png only).
 * @param {number}  opts.margin               - Quiet-zone margin in QR modules.
 * @param {string}  opts.darkColor            - Hex color for dark modules (default #000000).
 * @param {string}  opts.lightColor           - Hex color for light modules (default #ffffff).
 * @param {string}  opts.errorCorrectionLevel - L | M | Q | H (default M).
 * @param {string}  opts.format               - 'png' | 'svg'.
 * @returns {{ buffer: Buffer, mimeType: string, format: string }}
 */
async function generate({
  text,
  size,
  margin,
  darkColor,
  lightColor,
  errorCorrectionLevel,
  format,
}) {
  logger.info(
    `[qrcode] generating ${format} for "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`
  );

  const qrOptions = {
    errorCorrectionLevel,
    margin,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  };

  let buffer;
  let mimeType;

  if (format === 'svg') {
    const svgString = await QRCode.toString(text, { ...qrOptions, type: 'svg' });
    buffer = Buffer.from(svgString, 'utf8');
    mimeType = 'image/svg+xml';
  } else {
    // PNG — toBuffer returns a raw PNG Buffer
    buffer = await QRCode.toBuffer(text, {
      ...qrOptions,
      type: 'png',
      width: size,
    });
    mimeType = 'image/png';
  }

  logger.info(`[qrcode] done — ${buffer.length} bytes`);
  return { buffer, mimeType, format };
}

module.exports = { generate };
