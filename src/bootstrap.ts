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
 *   3. Otherwise create one master key whose plaintext IS the env value, so
 *      operators know exactly what to put in their `X-API-Key` header.
 *
 * Called from server.ts (NOT buildApp) — keeping it out of buildApp() means
 * tests that build the app in-memory never hit the DB for bootstrap, and
 * the function itself is independently importable + testable.
 */

import type { FastifyInstance } from 'fastify';
import { apiKeysService } from './modules/apiKeys/apiKeys.service.js';
import type { Env } from './config/env.js';

export interface BootstrapResult {
  status: 'skipped' | 'created' | 'already-exists';
  keyId?: string;
}

export async function ensureMasterKeyBootstrap(
  app: FastifyInstance,
  env: Env,
): Promise<BootstrapResult> {
  if (!env.MASTER_API_KEY_BOOTSTRAP) {
    return { status: 'skipped' };
  }

  const svc = apiKeysService(app.supabase);
  const existing = await svc.repo.listMasters();
  if (existing.length > 0) {
    app.log.info(
      { count: existing.length },
      'master API key already exists — bootstrap skipped (safe to remove MASTER_API_KEY_BOOTSTRAP)',
    );
    return { status: 'already-exists', keyId: existing[0]!.id };
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
  app.log.warn(
    { keyId: created.record.id },
    'BOOTSTRAP: provisioned master API key from MASTER_API_KEY_BOOTSTRAP — REMOVE that env var now and store the value in your secret manager',
  );
  return { status: 'created', keyId: created.record.id };
}
