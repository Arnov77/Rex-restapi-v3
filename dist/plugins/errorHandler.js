import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';
/**
 * Centralized error handler. Maps:
 *   - AppError       → its declared status + code
 *   - ZodError       → 400 with field issues
 *   - fastify schema → 400 with details
 *   - everything else → 500 (logged, body sanitized)
 */
export default fp(async (app) => {
    app.setErrorHandler((err, req, reply) => {
        if (err instanceof AppError) {
            req.log.warn({ err, code: err.code }, err.message);
            return reply.code(err.statusCode).send({
                ok: false,
                error: { code: err.code, message: err.message, details: err.details ?? null },
            });
        }
        if (err instanceof ZodError) {
            return reply.code(400).send({
                ok: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid request payload',
                    details: err.issues,
                },
            });
        }
        if (err.validation) {
            return reply.code(400).send({
                ok: false,
                error: { code: 'VALIDATION_ERROR', message: err.message, details: err.validation },
            });
        }
        const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        if (statusCode >= 500) {
            req.log.error({ err }, 'unhandled error');
        }
        else {
            req.log.warn({ err }, err.message);
        }
        return reply.code(statusCode).send({
            ok: false,
            error: {
                code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
                message: statusCode >= 500 ? 'Internal server error' : err.message,
                details: null,
            },
        });
    });
    app.setNotFoundHandler((req, reply) => {
        reply.code(404).send({
            ok: false,
            error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found`, details: null },
        });
    });
}, { name: 'error-handler' });
//# sourceMappingURL=errorHandler.js.map