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
  findById: vi.fn(),
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
  apiKeysRepoMock.findById.mockReset();
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

  it('rejects revoked keys with 401 (was: silently degrade to anon → 403)', async () => {
    // Hardening from the rate-limit-leak fix: a syntactically valid
    // key that lookup says is revoked now returns 401 INVALID/REVOKED
    // at preHandler instead of being treated as anon. This stops the
    // ghost "I'm logged in but headers say 100/day" reports we got
    // when stale clients held a regenerated-out key.
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
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('REVOKED_API_KEY');
  });

  it('rejects unknown-hash keys with 401 INVALID_API_KEY', async () => {
    // Same hardening: a syntactically valid key whose hash doesn't
    // match any row (deleted, never existed, regenerated and the
    // client kept the old plaintext) now fails loudly.
    apiKeysRepoMock.findByHash.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/master-only',
      headers: { 'x-api-key': 'rex_unknown-hash' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_API_KEY');
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

describe('authPlugin global preHandler — JWT → key cross-link', () => {
  // This block covers the rate-limit-leak fix. A request that ships
  // only a JWT (no X-API-Key) must still arrive at downstream
  // pre-handlers with req.apiKey populated, otherwise rate-limit and
  // quota bucket as anon-IP and the user sees 100/day despite being
  // signed in.
  const userKey = {
    id: 'k-1',
    tier: 'user',
    revoked: false,
    keyHash: 'h',
    keyEncrypted: null,
    dailyLimit: 1000,
    name: 'alice-key',
    createdAt: '',
    updatedAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };

  let inspector: { apiKeyTier: string | null; userId: string | null };
  let probeApp: FastifyInstance;

  beforeEach(async () => {
    inspector = { apiKeyTier: null, userId: null };
    // The /protected route runs after the global preHandler, so by
    // the time its handler fires req.apiKey + req.user should be
    // populated. We mount a tiny inspector that records what the
    // global preHandler decided for assertion.
    probeApp = Fastify({ logger: false });
    await probeApp.register(errorHandler);
    await probeApp.register(supabasePlugin);
    await probeApp.register(authPlugin);
    probeApp.get('/inspect', async (req) => {
      inspector.apiKeyTier = req.apiKey?.tier ?? null;
      inspector.userId = req.user?.id ?? null;
      return { ok: true };
    });
    await probeApp.ready();
    apiKeysRepoMock.findById = vi.fn();
  });

  afterEach(async () => {
    await probeApp.close();
  });

  it('JWT only → resolves user, cross-links to apiKey row, attaches both', async () => {
    usersRepoMock.findById.mockResolvedValue(validUser);
    apiKeysRepoMock.findById.mockResolvedValue(userKey);
    const token = sign({ sub: validUser.id, type: 'access' });

    const res = await probeApp.inject({
      method: 'GET',
      url: '/inspect',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(inspector.userId).toBe('u-1');
    expect(inspector.apiKeyTier).toBe('user');
    // The user lookup happens via JWT, the key lookup via the
    // user.api_key_id pointer — never via X-API-Key hash.
    expect(apiKeysRepoMock.findByHash).not.toHaveBeenCalled();
    expect(apiKeysRepoMock.findById).toHaveBeenCalledWith('k-1');
  });

  it('JWT only, but user has no apiKeyId → falls back to anon (no apiKey attached)', async () => {
    usersRepoMock.findById.mockResolvedValue({ ...validUser, apiKeyId: null });
    const token = sign({ sub: validUser.id, type: 'access' });

    const res = await probeApp.inject({
      method: 'GET',
      url: '/inspect',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(inspector.userId).toBe('u-1');
    expect(inspector.apiKeyTier).toBe(null);
  });

  it('JWT only, but the cross-linked key is revoked → no apiKey attached', async () => {
    usersRepoMock.findById.mockResolvedValue(validUser);
    apiKeysRepoMock.findById.mockResolvedValue({ ...userKey, revoked: true });
    const token = sign({ sub: validUser.id, type: 'access' });

    const res = await probeApp.inject({
      method: 'GET',
      url: '/inspect',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // user is authenticated, but apiKey stays null — request will
    // bucket as anon downstream. (Future: surface a "your key is
    // revoked, regenerate" hint to the dashboard.)
    expect(inspector.userId).toBe('u-1');
    expect(inspector.apiKeyTier).toBe(null);
  });

  it('expired JWT → silent anon (auth-optional endpoints stay reachable)', async () => {
    const expired = sign({ sub: validUser.id, type: 'access' }, { expiresIn: -10 });
    const res = await probeApp.inject({
      method: 'GET',
      url: '/inspect',
      headers: { authorization: `Bearer ${expired}` },
    });
    // No throw — global preHandler swallows verify failures so the
    // route stays anonymous-callable. authenticate() would 401 here
    // if the route required a JWT, but /inspect doesn't.
    expect(res.statusCode).toBe(200);
    expect(inspector.userId).toBe(null);
    expect(inspector.apiKeyTier).toBe(null);
  });

  it('X-API-Key wins over JWT when both supplied', async () => {
    // Belt-and-suspenders: a request that ships both should follow
    // the canonical bot path, not the dashboard fallback. extractJwt
    // skips bearer tokens that look like API keys, but the X-API-Key
    // header path is checked first regardless.
    apiKeysRepoMock.findByHash.mockResolvedValue({
      ...userKey,
      tier: 'master',
    });
    usersRepoMock.findById.mockResolvedValue(validUser);
    const token = sign({ sub: validUser.id, type: 'access' });

    const res = await probeApp.inject({
      method: 'GET',
      url: '/inspect',
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-key': 'rex_some-master-key',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(inspector.apiKeyTier).toBe('master');
    expect(apiKeysRepoMock.findByHash).toHaveBeenCalled();
    // The JWT branch shouldn't run when X-API-Key is present.
    expect(usersRepoMock.findById).not.toHaveBeenCalled();
  });
});
