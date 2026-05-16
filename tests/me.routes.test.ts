import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Mocks. We isolate the route layer + service from real Supabase by stubbing
// the underlying repos, same pattern as apiKeys.routes.test.ts.

const usersRepoMock = {
  findById: vi.fn(),
  findByEmail: vi.fn(),
  findByUsername: vi.fn(),
  insert: vi.fn(),
  touchLogin: vi.fn(),
  setApiKeyId: vi.fn(),
  publicView: vi.fn((rec: any) => {
    const { passwordHash: _h, ...rest } = rec;
    return rest;
  }),
};

const apiKeysRepoMock = {
  findByHash: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  update: vi.fn(),
  rotateHash: vi.fn(),
  touch: vi.fn().mockResolvedValue(undefined),
  publicView: vi.fn((rec: any) => {
    const { keyHash: _h, keyEncrypted: _e, ...rest } = rec;
    return rest;
  }),
};

const rateLimitRepoMock = {
  hit: vi.fn().mockResolvedValue({ allowed: true, count: 1, resetAt: new Date(Date.now() + 60_000) }),
  gc: vi.fn().mockResolvedValue(0),
};

const supabaseFromMock = {
  // Captures `.from('usage_daily').select(...).eq().eq().maybeSingle()` chain
  // used by quotaRepo.peek.
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: { count: 7 }, error: null }),
};

vi.mock('../src/plugins/supabase.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async (app: FastifyInstance) => {
      app.decorate('supabase', {
        from: vi.fn(() => supabaseFromMock),
        rpc: vi.fn(),
      } as any);
    }, { name: 'supabase' }),
  };
});

vi.mock('../src/modules/auth/users.repo.js', () => ({
  usersRepo: () => usersRepoMock,
}));

vi.mock('../src/modules/apiKeys/apiKeys.repo.js', () => ({
  apiKeysRepo: () => apiKeysRepoMock,
}));

vi.mock('../src/modules/rateLimit/rateLimit.repo.js', () => ({
  rateLimitRepo: () => rateLimitRepoMock,
}));

const supabasePlugin = (await import('../src/plugins/supabase.js')).default;
const authPlugin = (await import('../src/plugins/auth.js')).default;
const rateLimitPlugin = (await import('../src/plugins/rateLimit.js')).default;
const errorHandler = (await import('../src/plugins/errorHandler.js')).default;
const meRoutes = (await import('../src/modules/me/me.routes.js')).default;

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const KEY_ID = '00000000-0000-0000-0000-0000000000bb';

const userRecord = {
  id: USER_ID,
  username: 'arnov',
  email: 'a@example.com',
  passwordHash: '<hash-set-per-test>',
  apiKeyId: KEY_ID,
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
};

const keyRecord = {
  id: KEY_ID,
  name: 'arnov-key',
  tier: 'user' as const,
  keyHash: 'h',
  keyEncrypted: null,
  dailyLimit: 1000,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
  lastUsedAt: null,
  revoked: false,
  revokedAt: null,
};

const env = process.env;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandler);
  await app.register(supabasePlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.ready();
  return app;
}

function makeJwt(sub: string = USER_ID): string {
  return jwt.sign({ sub, type: 'access' }, env.JWT_SECRET as string, { expiresIn: '1h' });
}

let app: FastifyInstance;

beforeEach(async () => {
  Object.values(usersRepoMock).forEach((fn) => typeof fn === 'function' && (fn as any).mockReset?.());
  Object.values(apiKeysRepoMock).forEach((fn) => typeof fn === 'function' && (fn as any).mockReset?.());
  rateLimitRepoMock.hit.mockReset().mockResolvedValue({
    allowed: true,
    count: 1,
    resetAt: new Date(Date.now() + 60_000),
  });
  apiKeysRepoMock.touch.mockResolvedValue(undefined);
  apiKeysRepoMock.publicView.mockImplementation((rec: any) => {
    const { keyHash: _h, keyEncrypted: _e, ...rest } = rec;
    return rest;
  });
  usersRepoMock.publicView.mockImplementation((rec: any) => {
    const { passwordHash: _h, ...rest } = rec;
    return rest;
  });
  supabaseFromMock.select.mockClear().mockReturnThis();
  supabaseFromMock.eq.mockClear().mockReturnThis();
  supabaseFromMock.maybeSingle.mockClear().mockResolvedValue({ data: { count: 7 }, error: null });

  // Default user has known password "secret123".
  userRecord.passwordHash = await bcrypt.hash('secret123', 4);
  app = await buildTestApp();
});

afterEach(async () => {
  if (app) await app.close();
});

describe('GET /api/me', () => {
  it('rejects without JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the public user view (no passwordHash)', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.username).toBe('arnov');
    expect(body.data.user).not.toHaveProperty('passwordHash');
  });
});

describe('GET /api/me/key', () => {
  it('returns sanitized key (no hash/encrypted)', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue(keyRecord);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/key',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.key.id).toBe(KEY_ID);
    expect(body.data.key).not.toHaveProperty('keyHash');
    expect(body.data.key).not.toHaveProperty('keyEncrypted');
  });

  it('404 when user has no linked key', async () => {
    usersRepoMock.findById.mockResolvedValue({ ...userRecord, apiKeyId: null });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/key',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/me/key/reveal', () => {
  it('rejects with 403 on wrong password', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/reveal',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when key was not stored encrypted (user-tier default)', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue({ ...keyRecord, keyEncrypted: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/reveal',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'secret123' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('decrypts and returns plaintext when stored', async () => {
    const { encryptApiKey } = await import('../src/modules/apiKeys/apiKeys.crypto.js');
    const plaintext = 'rex_secret-payload-from-reveal';
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue({
      ...keyRecord,
      keyEncrypted: encryptApiKey(plaintext),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/reveal',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.plaintext).toBe(plaintext);
  });
});

describe('POST /api/me/key/regenerate', () => {
  it('forbids on wrong password and does not rotate', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/regenerate',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'wrong' },
    });
    expect(res.statusCode).toBe(403);
    expect(apiKeysRepoMock.rotateHash).not.toHaveBeenCalled();
  });

  it('rotates the hash and returns new plaintext', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue(keyRecord);
    apiKeysRepoMock.rotateHash.mockImplementation(async (id: string, hash: string, enc: string | null) => ({
      ...keyRecord,
      id,
      keyHash: hash,
      keyEncrypted: enc,
      updatedAt: new Date().toISOString(),
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/regenerate',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'secret123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.plaintext).toMatch(/^rex_/);
    // Same key id is preserved across regenerate (so quota counter follows).
    expect(body.data.key.id).toBe(KEY_ID);
    // Sanitized: no internal fields surface.
    expect(body.data.key).not.toHaveProperty('keyHash');
    expect(body.data.key).not.toHaveProperty('keyEncrypted');
  });

  it('refuses to regenerate a revoked key', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue({ ...keyRecord, revoked: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/key/regenerate',
      headers: { authorization: `Bearer ${makeJwt()}` },
      payload: { password: 'secret123' },
    });
    expect(res.statusCode).toBe(403);
    expect(apiKeysRepoMock.rotateHash).not.toHaveBeenCalled();
  });
});

describe('GET /api/me/usage', () => {
  it('returns user-tier counters with limit + remaining', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue(keyRecord);
    // supabaseFromMock.maybeSingle returns count: 7 by default.
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/usage',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.used).toBe(7);
    expect(body.data.limit).toBe(1000);
    expect(body.data.remaining).toBe(993);
    expect(body.data.resetInSeconds).toBeGreaterThan(0);
  });

  it('returns null limit/remaining for master tier', async () => {
    usersRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.findById.mockResolvedValue({ ...keyRecord, tier: 'master' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/usage',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.used).toBe(7);
    expect(body.data.limit).toBeNull();
    expect(body.data.remaining).toBeNull();
  });
});
