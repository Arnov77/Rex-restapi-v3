import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError, getPublicMessage } from '../shared/errors.js';
/**
 * Centralized error handler. Maps:
 *   - AppError       → its declared status + code
 *   - ZodError       → 400 with field issues
 *   - fastify schema → 400 with details
 *   - everything else → 500 (logged, body sanitized)
 *
 * Internal error messages go to logs only.
 * User-facing messages are sanitized and friendly.
 */
export default fp(async (app) => {
    app.setErrorHandler((err, req, reply) => {
        if (err instanceof AppError) {
            // Internal message → log only
            req.log.warn({ err, code: err.code, internalMessage: err.message }, `AppError: ${err.code}`);
            return reply.code(err.statusCode).send({
                ok: false,
                error: {
                    message: getPublicMessage(err),
                },
            });
        }
        if (err instanceof ZodError) {
            return reply.code(400).send({
                ok: false,
                error: {
                    message: 'Parameter tidak valid. Periksa kembali request yang dikirim.',
                },
            });
        }
        if (err.validation) {
            return reply.code(400).send({
                ok: false,
                error: {
                    message: 'Parameter tidak valid. Periksa kembali request yang dikirim.',
                },
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
                message: statusCode >= 500
                    ? 'Terjadi kesalahan pada server. Coba lagi nanti.'
                    : 'Terjadi kesalahan. Coba lagi nanti.',
            },
        });
    });
    app.setNotFoundHandler((req, reply) => {
        reply.code(404).send({
            ok: false,
            error: { message: 'Endpoint tidak ditemukan.' },
        });
    });
}, { name: 'error-handler' });
//# sourceMappingURL=errorHandler.js.map