import sharp from 'sharp';
import { withPage } from '@shared/browser/browserManager.js';
import { AppError, Internal } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { CaptionBody } from './caption.schemas.js';
import { renderCaptionHtml } from './caption.template.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface CaptionResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface CaptionInput {
  uploadBuffer?: Buffer;
  body: CaptionBody;
  signal?: AbortSignal;
}

const MIME: Record<'png' | 'jpeg' | 'webp', CaptionResult['mimeType']> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function decodeBase64Image(input: string): Buffer {
  const stripped = input.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  let buf: Buffer;
  try {
    buf = Buffer.from(stripped, 'base64');
  } catch {
    throw new AppError(400, 'CAPTION_INVALID_BASE64', 'image_base64 is not valid base64');
  }
  if (buf.length === 0) throw new AppError(400, 'CAPTION_EMPTY_IMAGE', 'Decoded image_base64 is empty');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(400, 'CAPTION_IMAGE_TOO_LARGE', 'Image exceeds 10MB limit');
  return buf;
}

async function bufferToDataUri(buffer: Buffer): Promise<string> {
  let mime = 'image/png';
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.format) mime = `image/${meta.format === 'jpg' ? 'jpeg' : meta.format}`;
  } catch {
    throw new AppError(400, 'CAPTION_INVALID_IMAGE', 'Could not read image data (unsupported or corrupt file)');
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function generateCaption(input: CaptionInput): Promise<CaptionResult> {
  const { body, uploadBuffer, signal } = input;

  const provided = [uploadBuffer, body.image_url, body.image_base64].filter(Boolean).length;
  if (provided === 0) {
    throw new AppError(400, 'CAPTION_NO_IMAGE', 'Provide image_url, image_base64, or upload a file');
  }
  if (provided > 1) {
    throw new AppError(400, 'CAPTION_MULTIPLE_IMAGE_SOURCES', 'Provide only ONE of: file upload, image_url, image_base64');
  }

  let imageSrc: string;
  if (body.image_url) {
    await assertPublicUrl(body.image_url);
    imageSrc = body.image_url;
  } else if (body.image_base64) {
    imageSrc = await bufferToDataUri(decodeBase64Image(body.image_base64));
  } else {
    imageSrc = await bufferToDataUri(uploadBuffer as Buffer);
  }

  const html = renderCaptionHtml({
    imageDataUri: imageSrc,
    captionText: body.caption_text,
    position: body.position,
    textColor: body.text_color,
    strokeColor: body.stroke_color,
  });

  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 8_000 })
        .catch(() => {});

      const el = await page.$('#canvas');
      if (!el) throw Internal('Caption canvas element not found');

      return el.screenshot({ type: 'png' });
    },
    { viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2, signal },
  );

  if (!png || png.length === 0) throw Internal('Caption render produced empty buffer');

  let buffer: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);

  if (body.format === 'jpeg') {
    buffer = await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: body.quality }).toBuffer();
  } else if (body.format === 'webp') {
    buffer = await sharp(buffer).webp({ quality: body.quality, effort: 3 }).toBuffer();
  }

  return { buffer, mimeType: MIME[body.format], format: body.format };
}
