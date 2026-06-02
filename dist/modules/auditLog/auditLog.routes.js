import { auditLogRepo } from './auditLog.repo.js';
import { ListAuditQuery, ListAuditResponse } from './auditLog.schemas.js';
const auditLogRoutes = async (app) => {
    app.get('/', {
        preHandler: [app.requireMaster],
        schema: {
            hide: true,
            tags: ['audit-log'],
            summary: 'List audit log entries (master only)',
            security: [{ apiKey: [] }],
            querystring: ListAuditQuery,
            response: { 200: ListAuditResponse },
        },
    }, async (req) => {
        const repo = auditLogRepo(app.supabase);
        const result = await repo.list({
            limit: req.query.limit,
            offset: req.query.offset,
            action: req.query.action,
            targetKeyId: req.query.targetKeyId,
        });
        return { ok: true, data: result };
    });
};
export default auditLogRoutes;
//# sourceMappingURL=auditLog.routes.js.map