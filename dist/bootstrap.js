/**
 * First-start master key provisioning.
 *
 * Without this, a brand-new deployment has no master key in the database,
 * which means `requireMaster` rejects every admin request — there's no way
 * to even create the first user key without poking Supabase by hand.
 *
 * Flow:
 *   1. If env `MASTER_API_KEY_BOOTSTRAP` is unset → nothing to do (idempotent).
 *   2. If at least one non-revoked master key already exists → nothing to do
 *      (don't accidentally mint a second one on every restart).
 *   3. Check if the hash for this specific plaintext already exists (even if
 *      revoked) — prevents unique constraint crash on restart after revoke.
 *   4. Otherwise create one master key whose plaintext IS the env value, so
 *      operators know exactly what to put in their `X-API-Key` header.
 *
 * Called from server.ts (NOT buildApp) — keeping it out of buildApp() means
 * tests that build the app in-memory never hit the DB for bootstrap, and
 * the function itself is independently importable + testable.
 */
import { apiKeysService } from './modules/apiKeys/apiKeys.service.js';
import { hashApiKey } from './modules/apiKeys/apiKeys.crypto.js';
export async function ensureMasterKeyBootstrap(app, env) {
    if (!env.MASTER_API_KEY_BOOTSTRAP) {
        return { status: 'skipped' };
    }
    const svc = apiKeysService(app.supabase);
    // 1. If at least one active (non-revoked) master key exists, nothing to do.
    const existing = await svc.repo.listMasters();
    if (existing.length > 0) {
        app.log.info({ count: existing.length }, 'master API key already exists — bootstrap skipped (safe to remove MASTER_API_KEY_BOOTSTRAP)');
        return { status: 'already-exists', keyId: existing[0].id };
    }
    // 2. Even if all master keys are revoked, check whether the hash for this
    //    specific bootstrap plaintext already lives in the DB. This handles the
    //    scenario where an operator revokes a bootstrap-master via /admin and
    //    then restarts the server — without this guard we'd hit a unique
    //    constraint violation on `key_hash`.
    const hash = hashApiKey(env.MASTER_API_KEY_BOOTSTRAP);
    const byHash = await svc.repo.findByHash(hash);
    if (byHash) {
        if (byHash.revoked) {
            app.log.warn({ keyId: byHash.id }, 'BOOTSTRAP: the bootstrap master key exists but is revoked — remove MASTER_API_KEY_BOOTSTRAP and set a new one to provision a fresh master key');
        }
        else {
            app.log.info({ keyId: byHash.id }, 'master API key already exists — bootstrap skipped');
        }
        return { status: 'already-exists', keyId: byHash.id };
    }
    const created = await svc.create({
        name: 'bootstrap-master',
        tier: 'master',
        dailyLimit: null,
        storeEncrypted: true,
        plaintextOverride: env.MASTER_API_KEY_BOOTSTRAP,
    });
    // Log loudly so this is impossible to miss in startup output. Never log
    // the plaintext itself — the operator already has it (it's their env var).
    app.log.warn({ keyId: created.record.id }, 'BOOTSTRAP: provisioned master API key from MASTER_API_KEY_BOOTSTRAP — REMOVE that env var now and store the value in your secret manager');
    return { status: 'created', keyId: created.record.id };
}
//# sourceMappingURL=bootstrap.js.map