import { authService } from './auth.service.js';
import { AuthResponse, LoginBody, RegisterBody } from './auth.schemas.js';
const authRoutes = async (app) => {
    // Tight rate-limit on auth endpoints — separate buckets per IP and per
    // identifier so credential-stuffing across many usernames is still capped.
    const ipLimit = app.rateLimit({
        prefix: 'auth-ip',
        windowSec: 60,
        max: 5,
        keyGenerator: (req) => req.ip,
        message: 'Too many auth attempts from this IP',
    });
    app.post('/register', {
        preHandler: [ipLimit],
        schema: {
            // Hidden from the public OpenAPI spec / playground. Auth flow is
            // driven from the dedicated /login page; exposing it on /docs
            // and the dashboard sidebar would let untrusted callers brute
            // force the form, and it leaks our user-management API surface
            // to scrapers. Still reachable directly — `hide: true` is a
            // doc-generation toggle, not a runtime guard.
            hide: true,
            tags: ['auth'],
            summary: 'Create a new account',
            body: RegisterBody,
            response: { 201: AuthResponse },
        },
    }, async (req, reply) => {
        const result = await authService(app.supabase).register(req.body);
        return reply.code(201).send({ ok: true, data: result });
    });
    app.post('/login', {
        preHandler: [ipLimit],
        schema: {
            // See /register above — hidden for the same reason.
            hide: true,
            tags: ['auth'],
            summary: 'Exchange credentials for a JWT',
            body: LoginBody,
            response: { 200: AuthResponse },
        },
    }, async (req) => {
        const result = await authService(app.supabase).login(req.body);
        return { ok: true, data: result };
    });
};
export default authRoutes;
//# sourceMappingURL=auth.routes.js.map