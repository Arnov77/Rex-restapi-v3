import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../../config/env.js';
import { Conflict, Unauthorized } from '../../shared/errors.js';
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
      });

      const userRow = await users.insert({
        id: userId,
        username,
        email,
        passwordHash,
        apiKeyId: created.record.id,
      });

      return {
        token: sign(userRow.id),
        user: users.publicView(userRow),
      };
    },

    async login(input: LoginBody): Promise<AuthResult> {
      const id = input.identifier.toLowerCase();
      const user = id.includes('@') ? await users.findByEmail(id) : await users.findByUsername(id);
      if (!user) throw Unauthorized('Invalid credentials');

      const ok = await bcrypt.compare(input.password, user.passwordHash);
      if (!ok) throw Unauthorized('Invalid credentials');

      await users.touchLogin(user.id);
      return {
        token: sign(user.id),
        user: users.publicView({ ...user, lastLoginAt: new Date().toISOString() }),
      };
    },
  };
}
