/**
 * Domain error type. Throwing one of these from anywhere in the stack
 * produces a clean JSON error response via the central error handler —
 * no `reply` object plumbing required in services.
 *
 * - `message`     → internal/developer message (goes to logs only)
 * - `userMessage` → user-facing message (goes to API response)
 *                   falls back to generic message based on status if not set
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown;
  public readonly userMessage?: string;

  constructor(statusCode: number, code: string, message: string, details?: unknown, userMessage?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.userMessage = userMessage;
  }
}

/** Default user-facing messages berdasarkan status code */
function defaultUserMessage(statusCode: number): string {
  if (statusCode === 400) return 'Request tidak valid. Periksa kembali parameter yang dikirim.';
  if (statusCode === 401) return 'Autentikasi diperlukan.';
  if (statusCode === 403) return 'Akses ditolak.';
  if (statusCode === 404) return 'Resource tidak ditemukan.';
  if (statusCode === 409) return 'Konflik dengan data yang sudah ada.';
  if (statusCode === 413) return 'Ukuran file terlalu besar.';
  if (statusCode === 429) return 'Terlalu banyak request. Coba lagi dalam beberapa saat.';
  if (statusCode === 503) return 'Layanan sedang tidak tersedia. Coba lagi nanti.';
  return 'Terjadi kesalahan. Coba lagi nanti.';
}

export function getPublicMessage(err: AppError): string {
  return err.userMessage ?? defaultUserMessage(err.statusCode);
}

export const BadRequest = (message: string, details?: unknown, userMessage?: string) =>
  new AppError(400, 'BAD_REQUEST', message, details, userMessage);
export const Unauthorized = (message = 'Unauthorized', userMessage?: string) =>
  new AppError(401, 'UNAUTHORIZED', message, undefined, userMessage);
export const Forbidden = (message = 'Forbidden', userMessage?: string) =>
  new AppError(403, 'FORBIDDEN', message, undefined, userMessage);
export const NotFound = (message = 'Not found', userMessage?: string) =>
  new AppError(404, 'NOT_FOUND', message, undefined, userMessage);
export const Conflict = (message: string, details?: unknown, userMessage?: string) =>
  new AppError(409, 'CONFLICT', message, details, userMessage);
export const TooManyRequests = (message = 'Too many requests', userMessage?: string) =>
  new AppError(429, 'RATE_LIMITED', message, undefined, userMessage);
export const Internal = (message = 'Internal error', details?: unknown) =>
  new AppError(500, 'INTERNAL_ERROR', message, details);
