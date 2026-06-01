import { randomUUID } from 'node:crypto';
import { apiKeysRepo } from './apiKeys.repo.js';
import { decryptApiKey, encryptApiKey, generatePlaintextKey, hashApiKey } from './apiKeys.crypto.js';
import { NotFound } from '../../shared/errors.js';
export function apiKeysService(db) {
    const repo = apiKeysRepo(db);
    return {
        async create(input) {
            const plaintext = input.plaintextOverride ?? generatePlaintextKey();
            const record = await repo.insert({
                id: randomUUID(),
                name: input.name,
                tier: input.tier,
                keyHash: hashApiKey(plaintext),
                keyEncrypted: input.storeEncrypted || input.tier === 'master' ? encryptApiKey(plaintext) : null,
                dailyLimit: input.dailyLimit ?? null,
            });
            return { plaintext, record };
        },
        async revealById(id) {
            const record = await repo.findById(id);
            if (!record)
                throw NotFound('API key not found');
            if (!record.keyEncrypted)
                throw NotFound('Key was not stored for reveal');
            return decryptApiKey(record.keyEncrypted);
        },
        async list(opts = {}) {
            const records = await repo.list(opts);
            return records.map((r) => repo.publicView(r));
        },
        async revoke(id) {
            const record = await repo.findById(id);
            if (!record)
                throw NotFound('API key not found');
            await repo.revoke(id);
        },
        async update(id, patch) {
            const record = await repo.findById(id);
            if (!record)
                throw NotFound('API key not found');
            return repo.update(id, patch);
        },
        /**
         * Rotate the secret of an existing key, keeping the same id (so the
         * user's user.api_key_id pointer stays valid and today's usage counter
         * — keyed by `key:<apiKeyId>` in the quota plugin — doesn't reset just
         * by rotating). The plaintext is returned ONCE here; caller surfaces
         * it to the user.
         *
         * If the existing key was stored encrypted (master tier, or created
         * with storeEncrypted), the new plaintext is also stored encrypted so
         * the owner can re-reveal later.
         */
        async regenerate(id) {
            const record = await repo.findById(id);
            if (!record)
                throw NotFound('API key not found');
            const plaintext = generatePlaintextKey();
            const wasStored = record.keyEncrypted !== null;
            const updated = await repo.rotateHash(id, hashApiKey(plaintext), wasStored || record.tier === 'master' ? encryptApiKey(plaintext) : null);
            return { plaintext, record: updated };
        },
        repo,
    };
}
//# sourceMappingURL=apiKeys.service.js.map