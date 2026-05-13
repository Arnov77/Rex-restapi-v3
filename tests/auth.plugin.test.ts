import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

// ── Stub the supabase plugin so authPlugin's `dependencies: ['supabase']`
//    is satisfied without touching a real DB. Also stub the repos that
//    authPlugin reaches for: usersRepo (JWT path) + apiKeysRepo (header path).

const usersRepoMock = {
  findById: vi.fn(),
  publicView: vi.fn((u: any) => {
    const { passwordHash: _h, ...rest } = u;
    return rest;
  }),
};
const apiKeysRepoMock = {
  findByHash: vi.fn(),
  touch: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../src/plugins/supabase.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async (app: FastifyInstance) => {
      app.decorate('supabase', {} as any);
    }, { name: 'supabase' }),
  };
});

vi.mock('../src/modules/auth/users.repo.js', () => ({
  usersRepo: () => usersRepoMock,
}));

vi.mock('../src/modules/apiKeys/apiKeys.repo.js', () => ({
  apiKeysRepo: () => apiKeysRepoMock,
}));

const supabasePlugin = (await import('../src/plugins/supabase.js')).default;
const authPlugin = (await import('../src/plugins/auth.js')).default;
const errorHandler = (await import('../src/plugins/errorHandler.js')).default;

function sign(payload: object, opts: jwt.SignOptions = {}) {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '1h', ...opts });
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(errorHandler);
  await app.register(supabasePlugin);
  await app.register(authPlugin);

  app.get('/protected', { preHandler: [app.authenticate] }, async (req) => ({
    ok: true,
    user: req.user,
  }));
  app.get('/master-only', { preHandler: [app.requireMaster] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  usersRepoMock.findById.mockReset();
  apiKeysRepoMock.findByHash.mockReset();
  apiKeysRepoMock.touch.mockClear();
  usersRepoMock.publicView.mockImplementation((u: any) => {
    const { passwordHash: _h, ...rest } = u;
    return rest;
  });
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

const validUser = {
  id: 'u-1',
  username: 'alice',
  email: 'alice@example.com',
  passwordHash: 'secret',
  apiKeyId: 'k-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

describe('authPlugin.authenticate (JWT guard)', () => {
  it('rejects requests without an Authorization header (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(usersRepoMock.findById).not.toHaveBeenCalled();
  });

  it('rejects malformed Authorization header (no Bearer)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an API-key-shaped bearer (rex_*) instead of JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer rex_thisIsAnApiKeyNotAJwt' },
    });
    // extractJwt() bails → "Missing bearer token"
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/missing|invalid/i);
  });

  it('rejects a tampered/invalid JWT (401, "Invalid token")', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not.a.real.jwt' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid token');
  });

  it('rejects a JWT signed with the wrong secret', async () => {
    const bad = jwt.sign({ sub: 'u-1', type: 'access' }, 'totally-wrong-secret-xxxxxxxxxxxxx', { expiresIn: '1h' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${bad}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid token');
    expect(usersRepoMock.findById).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT with "Token expired"', async () => {
    const expired = sign({ sub: 'u-1', type: 'access' }, { expiresIn: -10 });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Token expired');
  });

  it('rejects a valid JWT whose user no longer exists', async () => {
    usersRepoMock.findById.mockResolvedValue(null);
    const token = sign({ sub: 'u-gone', type: 'access' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('User no longer exists');
  });

  it('accepts a valid JWT, attaches sanitized user to req', async () => {
    usersRepoMock.findById.mockResolvedValue(validUser);
    const token = sign({ sub: validUser.id, type: 'access' });
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({ id: 'u-1', username: 'alice', email: 'alice@example.com' });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(usersRepoMock.findById).toHaveBeenCalledWith(validUser.id);
  });
});

describe('authPlugin.requireMaster (API key tier guard)', () => {
  it('forbids when no API key is supplied (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/master-only' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects an API key with a wrong format (not rex_*) at preHandler', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/master-only',
      headers: { 'x-api-key': 'plain-string-no-prefix' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/format/i);
  });

  it('forbids when the supplied key is a "user" tier', async () => {
    apiKeysRepoMock.findByHash.mockResolvedValue({
      id: 'k-user',
      tier: 'user',
      revoked: false,
      keyHash: 'h',
      keyEncrypted: null,
      dailyLimit: 100,
      name: 'k',
      createdAt: '',
      updatedAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/master-only',
      headers: { 'x-api-key': 'rex_some-user-tier-key' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ignores revoked keys (treated as anon → 403)', async () => {
    apiKeysRepoMock.findByHash.mockResolvedValue({
      id: 'k-master',
      tier: 'master',
      revoked: true,
      keyHash: 'h',
      keyEncrypted: null,
      dailyLimit: null,
      name: 'm',
      createdAt: '',
      updatedAt: null,
      lastUsedAt: null,
      revokedAt: '2026-01-01',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/master-only',
      headers: { 'x-api-key': 'rex_revoked-master-key' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows a valid master-tier key', async () => {
    apiKeysRepoMock.findByHash.mockResolvedValue({
      id: 'k-master',
      tier: 'master',
      revoked: false,
      keyHash: 'h',
      keyEncrypted: null,
      dailyLimit: null,
      name: 'm',
      createdAt: '',
      updatedAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/master-only',
      headers: { 'x-api-key': 'rex_valid-master' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
