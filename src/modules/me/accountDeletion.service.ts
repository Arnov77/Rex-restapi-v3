import bcrypt from 'bcryptjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Conflict, Forbidden, Internal, Unauthorized } from '@shared/errors.js';
import { usersRepo } from '../auth/users.repo.js';
import { apiKeysService } from '../apiKeys/apiKeys.service.js';

/**
 * Remove an account and everything tied to it.
 *
 * Order is deliberate. The Supabase Auth identity goes first: if that call
 * fails nothing has been lost yet and the user can simply retry. Doing it
 * last would risk leaving their email and name behind in auth.users after
 * everything else was gone — the opposite of what the privacy page says.
 *
 * Reset tokens disappear with the user row via ON DELETE CASCADE.
 * The admin audit log is kept on purpose: it records what administrators
 * did, not what the user did.
 */
export function accountDeletionService(db: SupabaseClient) {
  const users = usersRepo(db);
  const keys = apiKeysService(db);

  return {
    async deleteAccount(userId: string, password: string): Promise<void> {
      const user = await users.findById(userId);
      if (!user) throw Unauthorized('User no longer exists');

      // Same gate as reveal/rotate: a stolen session alone must not be
      // able to wipe the account.
      if (!user.passwordHash) {
        throw Conflict(
          'No password to confirm with', undefined,
          'Buat kata sandi dulu dari tab API Keys, lalu ulangi penghapusan akun.',
        );
      }
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        throw Forbidden('Password confirmation failed', 'Kata sandi salah.');
      }

      if (user.providerId) {
        const { error } = await db.auth.admin.deleteUser(user.providerId);
        // Already gone is fine; anything else stops before data is touched.
        if (error && !/not.?found/i.test(error.message)) {
          throw Internal(`deleteAccount: auth identity: ${error.message}`);
        }
      }

      if (user.apiKeyId) {
        await keys.revoke(user.apiKeyId);

        // Usage history, promised gone by the privacy page. Exact match on
        // the key's own counter — anonymous `ip:` counters are untouched.
        const { error: usageErr } = await db
          .from('usage_daily')
          .delete()
          .eq('counter_key', `key:${user.apiKeyId}`);
        if (usageErr) throw Internal(`deleteAccount: usage: ${usageErr.message}`);
      }

      const { error: slErr } = await db.from('shortlinks').delete().eq('user_id', userId);
      if (slErr) throw Internal(`deleteAccount: shortlinks: ${slErr.message}`);
      if (user.apiKeyId) {
        const { error: slKeyErr } = await db.from('shortlinks').delete().eq('api_key_id', user.apiKeyId);
        if (slKeyErr) throw Internal(`deleteAccount: shortlinks by key: ${slKeyErr.message}`);
      }

      await users.remove(userId);

      // revoke() above only flags the row — it still holds the username in
      // the key's name and the encrypted plaintext. Delete it outright now
      // that the user row no longer points at it. If another table still
      // references it, scrub the identifying fields so nothing personal is
      // left behind even though the row has to stay.
      if (user.apiKeyId) {
        const { error: kErr } = await db.from('api_keys').delete().eq('id', user.apiKeyId);
        if (kErr) {
          const { error: sErr } = await db
            .from('api_keys')
            .update({ name: 'deleted-account', key_encrypted: null })
            .eq('id', user.apiKeyId);
          if (sErr) throw Internal(`deleteAccount: api key cleanup: ${sErr.message}`);
        }
      }
    },
  };
}
