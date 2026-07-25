import sharp from 'sharp';
import { withPage } from '@shared/browser/browserManager.js';
import { Internal } from '@shared/errors.js';
import { resolveImageSrc } from '@shared/utils/imageInput.js';
import type { CombineBody } from './combine.schemas.js';
import { renderCombineHtml } from './combine.template.js';

export interface CombineResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface CombineInput {
  body: CombineBody;
  signal?: AbortSignal;
}

const MIME: Record<'png' | 'jpeg' | 'webp', CombineResult['mimeType']> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export async function generateCombine(input: CombineInput): Promise<CombineResult> {
  const { body, signal } = input;

  const imageSrcs = await Promise.all(body.images.map((img) => resolveImageSrc(img)));
  const layout = body.layout ?? body.images.map(() => 1);

  const html = renderCombineHtml({
    imageSrcs,
    layout,
    captionText: body.caption_text,
    position: body.position,
    rotation: body.rotation,
    textColor: body.text_color,
    strokeColor: body.stroke_color,
    gap: body.gap,
    width: body.width,
    cellAspectRatio: body.cell_aspect_ratio,
  });

  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 12_000 })
        .catch(() => {});

      const el = await page.$('#canvas');
      if (!el) throw Internal('Combine canvas element not found');

      return el.screenshot({ type: 'png' });
    },
    { viewport: { width: body.width, height: 1200 }, deviceScaleFactor: 2, signal },
  );

  if (!png || png.length === 0) throw Internal('Combine render produced empty buffer');

  let buffer: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);

  if (body.format === 'jpeg') {
    buffer = await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: body.quality }).toBuffer();
  } else if (body.format === 'webp') {
    buffer = await sharp(buffer).webp({ quality: body.quality, effort: 3 }).toBuffer();
  }

  return { buffer, mimeType: MIME[body.format], format: body.format };
}