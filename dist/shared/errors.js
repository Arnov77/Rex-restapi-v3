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
    statusCode;
    code;
    details;
    userMessage;
    constructor(statusCode, code, message, details, userMessage) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.userMessage = userMessage;
    }
}
/** Default user-facing messages berdasarkan status code */
function defaultUserMessage(statusCode) {
    if (statusCode === 400)
        return 'Request tidak valid. Periksa kembali parameter yang dikirim.';
    if (statusCode === 401)
        return 'Autentikasi diperlukan.';
    if (statusCode === 403)
        return 'Akses ditolak.';
    if (statusCode === 404)
        return 'Resource tidak ditemukan.';
    if (statusCode === 409)
        return 'Konflik dengan data yang sudah ada.';
    if (statusCode === 413)
        return 'Ukuran file terlalu besar.';
    if (statusCode === 429)
        return 'Terlalu banyak request. Coba lagi dalam beberapa saat.';
    if (statusCode === 503)
        return 'Layanan sedang tidak tersedia. Coba lagi nanti.';
    return 'Terjadi kesalahan. Coba lagi nanti.';
}
export function getPublicMessage(err) {
    return err.userMessage ?? defaultUserMessage(err.statusCode);
}
export const BadRequest = (message, details, userMessage) => new AppError(400, 'BAD_REQUEST', message, details, userMessage);
export const Unauthorized = (message = 'Unauthorized', userMessage) => new AppError(401, 'UNAUTHORIZED', message, undefined, userMessage);
export const Forbidden = (message = 'Forbidden', userMessage) => new AppError(403, 'FORBIDDEN', message, undefined, userMessage);
export const NotFound = (message = 'Not found', userMessage) => new AppError(404, 'NOT_FOUND', message, undefined, userMessage);
export const Conflict = (message, details, userMessage) => new AppError(409, 'CONFLICT', message, details, userMessage);
export const TooManyRequests = (message = 'Too many requests', userMessage) => new AppError(429, 'RATE_LIMITED', message, undefined, userMessage);
export const Internal = (message = 'Internal error', details) => new AppError(500, 'INTERNAL_ERROR', message, details);
//# sourceMappingURL=errors.js.map