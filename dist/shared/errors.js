/**
 * Domain error type. Throwing one of these from anywhere in the stack
 * produces a clean JSON error response via the central error handler —
 * no `reply` object plumbing required in services.
 */
export class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
export const BadRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', message);
export const Forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const NotFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const Conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
export const TooManyRequests = (message = 'Too many requests') => new AppError(429, 'RATE_LIMITED', message);
export const Internal = (message = 'Internal error', details) => new AppError(500, 'INTERNAL_ERROR', message, details);
//# sourceMappingURL=errors.js.map