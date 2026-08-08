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

/** Default user-facing messages, keyed by status code. */
function defaultUserMessage(statusCode: number): string {
  if (statusCode === 400) return 'Invalid request. Check the parameters you sent.';
  if (statusCode === 401) return 'Authentication required.';
  if (statusCode === 403) return 'Access denied.';
  if (statusCode === 404) return 'Resource not found.';
  if (statusCode === 409) return 'Conflicts with existing data.';
  if (statusCode === 413) return 'File is too large.';
  if (statusCode === 429) return 'Too many requests. Please try again shortly.';
  if (statusCode === 503) return 'Service temporarily unavailable. Please try again later.';
  return 'Something went wrong. Please try again later.';
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
