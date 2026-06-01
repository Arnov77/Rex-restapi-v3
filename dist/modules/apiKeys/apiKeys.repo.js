import { Internal } from '../../shared/errors.js';
const TABLE = 'api_keys';
const toRecord = (r) => r && {
    id: r.id,
    name: r.name,
    tier: r.tier,
    keyHash: r.key_hash,
    keyEncrypted: r.key_encrypted,
    dailyLimit: r.daily_limit,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
    revoked: r.revoked,
    revokedAt: r.revoked_at,
};
export function apiKeysRepo(db) {
    return {
        publicView(rec) {
            const { keyHash: _h, keyEncrypted: _e, ...rest } = rec;
            return rest;
        },
        async findById(id) {
            const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle();
            if (error)
                throw Internal(`apiKeys.findById: ${error.message}`);
            return toRecord(data);
        },
        async findByHash(hash) {
            const { data, error } = await db.from(TABLE).select('*').eq('key_hash', hash).maybeSingle();
            if (error)
                throw Internal(`apiKeys.findByHash: ${error.message}`);
            return toRecord(data);
        },
        async list(opts = {}) {
            let q = db.from(TABLE).select('*').order('created_at', { ascending: false });
            if (!opts.includeRevoked)
                q = q.eq('revoked', false);
            const { data, error } = await q;
            if (error)
                throw Internal(`apiKeys.list: ${error.message}`);
            return (data ?? []).map((r) => toRecord(r)).filter(Boolean);
        },
        async listMasters() {
            const { data, error } = await db
                .from(TABLE)
                .select('*')
                .eq('tier', 'master')
                .eq('revoked', false);
            if (error)
                throw Internal(`apiKeys.listMasters: ${error.message}`);
            return (data ?? []).map((r) => toRecord(r)).filter(Boolean);
        },
        async insert(input) {
            const { data, error } = await db
                .from(TABLE)
                .insert({
                id: input.id,
                name: input.name,
                tier: input.tier,
                key_hash: input.keyHash,
                key_encrypted: input.keyEncrypted,
                daily_limit: input.dailyLimit,
            })
                .select('*')
                .single();
            if (error || !data)
                throw Internal(`apiKeys.insert: ${error?.message ?? 'no data'}`);
            return toRecord(data);
        },
        async revoke(id) {
            const { error } = await db
                .from(TABLE)
                .update({ revoked: true, revoked_at: new Date().toISOString() })
                .eq('id', id);
            if (error)
                throw Internal(`apiKeys.revoke: ${error.message}`);
        },
        async activate(id) {
            const { data, error } = await db
                .from(TABLE)
                .update({ revoked: false, revoked_at: null, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select('*')
                .single();
            if (error || !data)
                throw Internal(`apiKeys.activate: ${error?.message ?? 'no data'}`);
            return toRecord(data);
        },
        /**
         * Patch a key's mutable fields. Only `name` and `dailyLimit` are
         * exposed today — tier/hash/revoked are managed by dedicated paths.
         * Pass `dailyLimit: null` for "unlimited" (the schema column is nullable).
         */
        async update(id, patch) {
            const row = { updated_at: new Date().toISOString() };
            if (patch.name !== undefined)
                row.name = patch.name;
            if (patch.dailyLimit !== undefined)
                row.daily_limit = patch.dailyLimit;
            const { data, error } = await db
                .from(TABLE)
                .update(row)
                .eq('id', id)
                .select('*')
                .single();
            if (error || !data)
                throw Internal(`apiKeys.update: ${error?.message ?? 'no data'}`);
            return toRecord(data);
        },
        /**
         * Replace the hash/encrypted blob in-place. Used by regenerate so the
         * key id stays the same — dependent rows (users.api_key_id, daily
         * usage carry-over) don't need to migrate.
         */
        async rotateHash(id, keyHash, keyEncrypted) {
            const { data, error } = await db
                .from(TABLE)
                .update({
                key_hash: keyHash,
                key_encrypted: keyEncrypted,
                updated_at: new Date().toISOString(),
            })
                .eq('id', id)
                .select('*')
                .single();
            if (error || !data)
                throw Internal(`apiKeys.rotateHash: ${error?.message ?? 'no data'}`);
            return toRecord(data);
        },
        async touch(id) {
            const { error } = await db.from(TABLE).update({ last_used_at: new Date().toISOString() }).eq('id', id);
            if (error)
                throw Internal(`apiKeys.touch: ${error.message}`);
        },
    };
}
//# sourceMappingURL=apiKeys.repo.js.map