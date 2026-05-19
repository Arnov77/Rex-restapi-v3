import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '../../shared/errors.js';

const TABLE = 'audit_log';

export type AuditAction =
  | 'key.created'
  | 'key.revoked'
  | 'key.activated'
  | 'key.regenerated'
  | 'key.updated';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  targetKeyId: string;
  targetKeyName: string;
  actorKeyId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface Row {
  id: string;
  action: string;
  target_key_id: string;
  target_key_name: string;
  actor_key_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const toEntry = (r: Row): AuditEntry => ({
  id: r.id,
  action: r.action as AuditAction,
  targetKeyId: r.target_key_id,
  targetKeyName: r.target_key_name,
  actorKeyId: r.actor_key_id,
  metadata: r.metadata,
  createdAt: r.created_at,
});

export interface InsertAuditInput {
  action: AuditAction;
  targetKeyId: string;
  targetKeyName: string;
  actorKeyId: string;
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditOpts {
  limit?: number;
  offset?: number;
  action?: AuditAction;
  targetKeyId?: string;
}

export function auditLogRepo(db: SupabaseClient) {
  return {
    async insert(input: InsertAuditInput): Promise<void> {
      const { error } = await db.from(TABLE).insert({
        action: input.action,
        target_key_id: input.targetKeyId,
        target_key_name: input.targetKeyName,
        actor_key_id: input.actorKeyId,
        metadata: input.metadata ?? null,
      });
      if (error) {
        // Fail-open: audit logging should never crash the main operation.
        // Log the error but don't throw — the caller's primary action
        // already succeeded at this point.
        console.error('[auditLog.insert]', error.message);
      }
    },

    async list(opts: ListAuditOpts = {}): Promise<{ entries: AuditEntry[]; total: number }> {
      const limit = Math.min(opts.limit ?? 50, 200);
      const offset = opts.offset ?? 0;

      let query = db
        .from(TABLE)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (opts.action) query = query.eq('action', opts.action);
      if (opts.targetKeyId) query = query.eq('target_key_id', opts.targetKeyId);

      const { data, error, count } = await query;
      if (error) throw Internal(`auditLog.list: ${error.message}`);
      return {
        entries: (data ?? []).map((r) => toEntry(r as Row)),
        total: count ?? 0,
      };
    },
  };
}
