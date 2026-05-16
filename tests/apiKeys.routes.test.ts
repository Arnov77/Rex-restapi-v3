import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

// ── Mocks for the supabase plugin + repo + service collaborators. ─────────

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

vi.mock('../src/plugins/supabase.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async (app: FastifyInstance) => {
      app.decorate('supabase', {} as any);
    }, { name: 'supabase' }),
  };
});

vi.mock('../src/modules/apiKeys/apiKeys.repo.js', () => ({
  apiKeysRepo: () => apiKeysRepoMock,
}));

const supabasePlugin = (await import('../src/plugins/supabase.js')).default;
const authPlugin = (await import('../src/plugins/auth.js')).default;
const errorHandler = (await import('../src/plugins/errorHandler.js')).default;
const apiKeyRoutes = (await import('../src/modules/apiKeys/apiKeys.routes.js')).default;

const MASTER_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const masterRecord = {
  id: MASTER_ID,
  name: 'master',
  tier: 'master' as const,
  keyHash: 'h',
  keyEncrypted: 'iv:tag:ct',
  dailyLimit: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
  lastUsedAt: null,
  revoked: false,
  revokedAt: null,
};

const userRecord = {
  ...masterRecord,
  id: USER_ID,
  name: 'user',
  tier: 'user' as const,
  keyEncrypted: null,
  dailyLimit: 1000,
};

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandler);
  await app.register(supabasePlugin);
  await app.register(authPlugin);
  await app.register(apiKeyRoutes, { prefix: '/api/keys' });
  await app.ready();
  return app;
}

const masterHeader = { 'x-api-key': 'rex_master-key-plaintext' };

let app: FastifyInstance;

beforeEach(async () => {
  Object.values(apiKeysRepoMock).forEach((fn) => typeof fn === 'function' && (fn as any).mockReset?.());
  apiKeysRepoMock.touch.mockResolvedValue(undefined);
  apiKeysRepoMock.publicView.mockImplementation((rec: any) => {
    const { keyHash: _h, keyEncrypted: _e, ...rest } = rec;
    return rest;
  });
  // Default: any rex_* key resolves to a valid master record so authPlugin admits it.
  apiKeysRepoMock.findByHash.mockResolvedValue(masterRecord);
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/keys (list)', () => {
  it('forbids when no API key is supplied', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/keys' });
    expect(res.statusCode).toBe(403);
  });

  it('forbids non-master keys', async () => {
    apiKeysRepoMock.findByHash.mockResolvedValue(userRecord);
    const res = await app.inject({ method: 'GET', url: '/api/keys', headers: { 'x-api-key': 'rex_user' } });
    expect(res.statusCode).toBe(403);
  });

  it('returns sanitized list (no keyHash / keyEncrypted) for master', async () => {
    apiKeysRepoMock.list.mockResolvedValue([masterRecord, userRecord]);
    const res = await app.inject({ method: 'GET', url: '/api/keys', headers: masterHeader });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.keys).toHaveLength(2);
    for (const k of body.data.keys) {
      expect(k).not.toHaveProperty('keyHash');
      expect(k).not.toHaveProperty('keyEncrypted');
    }
    expect(apiKeysRepoMock.list).toHaveBeenCalledWith({ includeRevoked: false });
  });

  it('passes includeRevoked=true through to the repo', async () => {
    apiKeysRepoMock.list.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/keys?includeRevoked=true', headers: masterHeader });
    expect(res.statusCode).toBe(200);
    expect(apiKeysRepoMock.list).toHaveBeenCalledWith({ includeRevoked: true });
  });
});

describe('POST /api/keys (create)', () => {
  it('forbids without master key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/keys', payload: { name: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid body (missing name)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/keys', headers: masterHeader, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('mints a key and returns plaintext + sanitized record', async () => {
    apiKeysRepoMock.insert.mockImplementation(async (input: any) => ({
      ...userRecord,
      id: input.id,
      name: input.name,
      tier: input.tier,
      keyHash: input.keyHash,
      keyEncrypted: input.keyEncrypted,
      dailyLimit: input.dailyLimit,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: masterHeader,
      payload: { name: 'bot-1', tier: 'user', dailyLimit: 500 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.plaintext).toMatch(/^rex_/);
    expect(body.data.key).toMatchObject({ name: 'bot-1', tier: 'user', dailyLimit: 500 });
    expect(body.data.key).not.toHaveProperty('keyHash');
    expect(body.data.key).not.toHaveProperty('keyEncrypted');

    const insertArg = apiKeysRepoMock.insert.mock.calls[0]![0];
    expect(insertArg.keyEncrypted).toBeNull(); // user tier → not stored encrypted
  });

  it('stores encrypted blob for master tier (so it can be revealed later)', async () => {
    apiKeysRepoMock.insert.mockImplementation(async (input: any) => ({ ...masterRecord, ...input }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: masterHeader,
      payload: { name: 'admin', tier: 'master' },
    });
    expect(res.statusCode).toBe(201);
    const insertArg = apiKeysRepoMock.insert.mock.calls[0]![0];
    expect(insertArg.tier).toBe('master');
    expect(typeof insertArg.keyEncrypted).toBe('string');
    expect(insertArg.keyEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe('GET /api/keys/:id/reveal', () => {
  it('forbids without master key', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/keys/${masterRecord.id}/reveal` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when the key does not exist', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/00000000-0000-0000-0000-000000000000/reveal',
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the key was not stored encrypted (e.g. user tier)', async () => {
    apiKeysRepoMock.findById.mockResolvedValue({ ...userRecord, keyEncrypted: null });
    const res = await app.inject({
      method: 'GET',
      url: `/api/keys/${userRecord.id}/reveal`,
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it('decrypts and returns plaintext when stored', async () => {
    // Encrypt a real plaintext via the same crypto module so decrypt round-trips.
    const { encryptApiKey } = await import('../src/modules/apiKeys/apiKeys.crypto.js');
    const plaintext = 'rex_super-secret-master-payload';
    apiKeysRepoMock.findById.mockResolvedValue({
      ...masterRecord,
      keyEncrypted: encryptApiKey(plaintext),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/keys/${masterRecord.id}/reveal`,
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: { plaintext } });
  });

  it('rejects non-uuid id with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/keys/not-a-uuid/reveal',
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/keys/:id (revoke)', () => {
  it('forbids without master key', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/keys/${masterRecord.id}` });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when key does not exist', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/keys/00000000-0000-0000-0000-000000000000',
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(404);
    expect(apiKeysRepoMock.revoke).not.toHaveBeenCalled();
  });

  it('revokes existing key and returns ok', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(masterRecord);
    apiKeysRepoMock.revoke.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/keys/${masterRecord.id}`,
      headers: masterHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(apiKeysRepoMock.revoke).toHaveBeenCalledWith(masterRecord.id);
  });
});

describe('PATCH /api/keys/:id (update)', () => {
  it('forbids without master key', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${userRecord.id}`,
      payload: { dailyLimit: 5000 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects empty body (must provide at least one field)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${userRecord.id}`,
      headers: masterHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative dailyLimit', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${userRecord.id}`,
      headers: masterHeader,
      payload: { dailyLimit: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when key does not exist', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/keys/00000000-0000-0000-0000-000000000000',
      headers: masterHeader,
      payload: { dailyLimit: 5000 },
    });
    expect(res.statusCode).toBe(404);
    expect(apiKeysRepoMock.update).not.toHaveBeenCalled();
  });

  it('upgrades dailyLimit and returns sanitized record', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.update.mockResolvedValue({ ...userRecord, dailyLimit: 5000 });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${userRecord.id}`,
      headers: masterHeader,
      payload: { dailyLimit: 5000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.key.dailyLimit).toBe(5000);
    expect(body.data.key).not.toHaveProperty('keyHash');
    expect(apiKeysRepoMock.update).toHaveBeenCalledWith(userRecord.id, { dailyLimit: 5000 });
  });

  it('accepts null dailyLimit (unlimited)', async () => {
    apiKeysRepoMock.findById.mockResolvedValue(userRecord);
    apiKeysRepoMock.update.mockResolvedValue({ ...userRecord, dailyLimit: null });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${userRecord.id}`,
      headers: masterHeader,
      payload: { dailyLimit: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.key.dailyLimit).toBeNull();
  });
});
