import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@shared/errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface UploadedImage {
  buffer?: Buffer;
  filename?: string;
  mimetype?: string;
}

export interface ImageResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/webp';
  format: 'png' | 'webp';
  provider: 'poof' | 'removebg';
}

export async function readMultipartImage(req: FastifyRequest): Promise<UploadedImage> {
  if (!req.isMultipart()) return {};

  const data = await req.file({
    limits: { fileSize: MAX_IMAGE_BYTES },
  });

  if (!data) return {};

  if (!data.mimetype?.startsWith('image/')) {
    throw new AppError(400, 'BACKGROUND_INVALID_FILE', 'Uploaded file must be an image');
  }

  const buffer = await data.toBuffer();

  if (buffer.length === 0) {
    throw new AppError(400, 'BACKGROUND_EMPTY_FILE', 'Image file is empty');
  }

  return {
    buffer,
    filename: data.filename,
    mimetype: data.mimetype,
  };
}

export function sendImageResult(
  reply: FastifyReply,
  result: ImageResult,
  filenamePrefix: string,
) {
  return reply
    .header('content-type', result.mimeType)
    .header('content-length', String(result.buffer.length))
    .header('content-disposition', `inline; filename="${filenamePrefix}.${result.format}"`)
    .header('cache-control', 'no-store')
    .header('x-provider', result.provider)
    .send(result.buffer);
}
