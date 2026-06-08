import QRCode from 'qrcode';
import type { QrQuery } from './qr.schemas.js';

export async function generateQr(opts: QrQuery): Promise<{ data: Buffer | string; mime: string }> {
  const dark = `#${opts.color}`;
  const light = `#${opts.bg}`;

  if (opts.format === 'svg') {
    const svg = await QRCode.toString(opts.query, {
      type: 'svg',
      width: opts.size,
      color: { dark, light },
    });
    return { data: svg, mime: 'image/svg+xml' };
  }

  const buffer = await QRCode.toBuffer(opts.query, {
    type: 'png',
    width: opts.size,
    color: { dark, light },
  });
  return { data: buffer, mime: 'image/png' };
}
