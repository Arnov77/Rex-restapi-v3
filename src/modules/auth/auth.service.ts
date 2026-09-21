import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../../config/env.js';
import { Conflict, Internal, Unauthorized } from '@shared/errors.js';
import { usersRepo, type PublicUser } from './users.repo.js';
import { apiKeysService } from '../apiKeys/apiKeys.service.js';
import type { LoginBody, RegisterBody } from './auth.schemas.js';

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export function authService(db: SupabaseClient) {
  const users = usersRepo(db);
  const keys = apiKeysService(db);
  const env = loadEnv();

  /**
   * Build a username from an email local-part, within the same rules the
   * register schema enforces (3-32 chars, [a-zA-Z0-9_]).
   *
   * Collisions are expected — two people can share a local-part across
   * different domains — so the caller retries with a suffix. We do not
   * pre-check availability: between the check and the insert someone else
   * could take it, and the unique index is the only real arbiter.
   */
  function usernameFromEmail(email: string, suffix = ''): string {
    const base = email
      .split('@')[0]!
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 32 - suffix.length);
    const padded = base.length >= 3 ? base : (base + 'user').slice(0, 32 - suffix.length);
    return padded + suffix;
  }

  function sign(userId: string): string {
    return jwt.sign({ sub: userId, type: 'access' }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
  }

  return {
    async register(input: RegisterBody): Promise<AuthResult> {
      const username = input.username.toLowerCase();
      const email = input.email.toLowerCase();

      // Pre-check uniqueness for clean error messages — DB constraints are
      // the actual source of truth (race-safe).
      const [byEmail, byName] = await Promise.all([users.findByEmail(email), users.findByUsername(username)]);
      if (byEmail) throw Conflict('Email already registered');
      if (byName) throw Conflict('Username already taken');

      const passwordHash = await bcrypt.hash(input.password, 12);
      const userId = randomUUID();

      // Provision a personal API key first so we can store its id on the user row.
      const created = await keys.create({
        name: `${username}-key`,
        tier: 'user',
        dailyLimit: env.USER_DAILY_QUOTA,
        storeEncrypted: env.API_KEY_REVEALABLE,
      });

      const userRow = await users.insert({
        id: userId,
        username,
        email,
        passwordHash,
        apiKeyId: created.record.id,
        provider: 'password',
        providerId: null,
        displayName: null,
      });

      return {
        token: sign(userRow.id),
        user: users.publicView(userRow),
      };
    },

    async login(input: LoginBody): Promise<AuthResult> {
      const id = input.identifier.toLowerCase();
      const user = id.includes('@') ? await users.findByEmail(id) : await users.findByUsername(id);
      if (!user) throw Unauthorized('Invalid credentials', 'Email, username, atau kata sandi salah.');

      // Provider-only accounts have no hash to compare against. Say so
      // plainly — "wrong password" would send them in circles.
      if (!user.passwordHash) {
        throw Unauthorized(
          'Account has no password set',
          'Akun ini dibuat lewat ' + user.provider + '. Masuk pakai tombol tersebut.',
        );
      }
      const ok = await bcrypt.compare(input.password, user.passwordHash);
      if (!ok) throw Unauthorized('Invalid credentials', 'Email, username, atau kata sandi salah.');

      await users.touchLogin(user.id);
      return {
        token: sign(user.id),
        user: users.publicView({ ...user, lastLoginAt: new Date().toISOString() }),
      };
    },

    /**
     * Sign in through an identity provider (Google, GitHub).
     *
     * Resolution order matters:
     *   1. Provider identity — stable even if the user changes their
     *      provider email, so it wins over an email match.
     *   2. Verified email — the same person who already registered with a
     *      password. Link the provider to that row so they keep their
     *      username, API key and history instead of getting a second
     *      account with a second quota.
     *   3. Otherwise a genuinely new account.
     *
     * Step 2 is gated on the provider asserting the address is verified.
     * Without that check, anyone able to create a provider account bearing
     * someone else's address could take over their Rex API account.
     */
    async loginWithProvider(input: {
      provider: 'google' | 'github';
      providerId: string;
      email: string;
      emailVerified: boolean;
      /** Handle from the provider, when it has one (GitHub does). */
      preferredUsername?: string;
      /** Human name for greetings. */
      displayName?: string;
    }): Promise<AuthResult> {
      const email = input.email.toLowerCase();

      const byProvider = await users.findByProvider(input.provider, input.providerId);
      if (byProvider) {
        await users.touchLogin(byProvider.id);
        return { token: sign(byProvider.id), user: users.publicView(byProvider) };
      }

      const byEmail = await users.findByEmail(email);
      if (byEmail) {
        if (!input.emailVerified) {
          throw Unauthorized(
            'Provider email not verified',
            'Email ini sudah terdaftar. Masuk pakai kata sandi, atau verifikasi email di ' + input.provider + ' dulu.',
          );
        }
        await users.linkProvider(byEmail.id, input.provider, input.providerId);
        await users.touchLogin(byEmail.id);
        const linked = await users.findById(byEmail.id);
        return { token: sign(byEmail.id), user: users.publicView(linked ?? byEmail) };
      }

      // New account. Username is derived, so a clash is ordinary rather
      // than exceptional — retry with a suffix and let the unique index
      // decide. A handful of attempts is plenty; beyond that something
      // else is wrong and failing loudly beats looping.
      const userId = randomUUID();
      const created = await keys.create({
        name: `${usernameFromEmail(email)}-key`,
        tier: 'user',
        dailyLimit: env.USER_DAILY_QUOTA,
        storeEncrypted: env.API_KEY_REVEALABLE,
      });

      // Prefer the provider's own handle — people recognise themselves by
      // it far more than by the front of their email address.
      const preferred = (input.preferredUsername ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 32);
      const usable = preferred.length >= 3 ? preferred : null;

      for (let attempt = 0; attempt < 6; attempt++) {
        const suffix = attempt === 0 ? '' : String(attempt);
        const username = usable
          ? usable.slice(0, 32 - suffix.length) + suffix
          : usernameFromEmail(email, suffix);
        try {
          const userRow = await users.insert({
            id: userId,
            username,
            email,
            passwordHash: null,
            apiKeyId: created.record.id,
            provider: input.provider,
            providerId: input.providerId,
            displayName: input.displayName ?? null,
          });
          return { token: sign(userRow.id), user: users.publicView(userRow) };
        } catch (err) {
          const msg = String((err as Error)?.message ?? '');
          const isUsernameClash = msg.includes('users_username_key');
          if (!isUsernameClash) throw err;
        }
      }

      throw Internal('Could not derive a free username after several attempts');
    },
  };
}
