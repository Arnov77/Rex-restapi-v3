import sharp from 'sharp';
import { AppError } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function decodeBase64Image(input: string): Buffer {
  const stripped = input.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  let buf: Buffer;
  try {
    buf = Buffer.from(stripped, 'base64');
  } catch {
    throw new AppError(400, 'IMAGE_INVALID_BASE64', 'Provided base64 image data is not valid base64');
  }
  if (buf.length === 0) throw new AppError(400, 'IMAGE_EMPTY', 'Decoded image is empty');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(400, 'IMAGE_TOO_LARGE', 'Image exceeds 10MB limit');
  return buf;
}

export async function bufferToDataUri(buffer: Buffer): Promise<string> {
  let mime = 'image/png';
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.format) mime = `image/${meta.format === 'jpg' ? 'jpeg' : meta.format}`;
  } catch {
    throw new AppError(400, 'IMAGE_INVALID', 'Could not read image data (unsupported or corrupt file)');
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function resolveImageSrc(input: string): Promise<string> {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    await assertPublicUrl(trimmed);
    return trimmed;
  }
  return bufferToDataUri(decodeBase64Image(trimmed));
}