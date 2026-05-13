import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ── Mock the two collaborators that auth.service depends on. ──────────────
// We re-mock per test via mockReset so each case can stage its own behavior.

const usersMock = {
  findByEmail: vi.fn(),
  findByUsername: vi.fn(),
  insert: vi.fn(),
  touchLogin: vi.fn(),
  publicView: vi.fn((u: any) => {
    const { passwordHash: _h, ...rest } = u;
    return rest;
  }),
};

const apiKeysMock = {
  create: vi.fn(),
};

vi.mock('../src/modules/auth/users.repo.js', () => ({
  usersRepo: () => usersMock,
}));

vi.mock('../src/modules/apiKeys/apiKeys.service.js', () => ({
  apiKeysService: () => apiKeysMock,
}));

// Imported AFTER the mocks above so the service picks them up.
const { authService } = await import('../src/modules/auth/auth.service.js');
const { AppError } = await import('../src/shared/errors.js');

const fakeDb = {} as any;

beforeEach(() => {
  Object.values(usersMock).forEach((fn) => typeof fn === 'function' && (fn as any).mockReset?.());
  Object.values(apiKeysMock).forEach((fn) => (fn as any).mockReset?.());
  // restore default publicView impl after reset
  usersMock.publicView.mockImplementation((u: any) => {
    const { passwordHash: _h, ...rest } = u;
    return rest;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const validRegister = {
  username: 'Alice',
  email: 'Alice@Example.com',
  password: 'sup3rsecret!',
};

function stubInsertedUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'hashed',
    apiKeyId: 'key-uuid-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    ...overrides,
  };
}

describe('authService.register', () => {
  it('creates user, mints API key, returns signed JWT', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue(null);
    apiKeysMock.create.mockResolvedValue({
      plaintext: 'rex_plain',
      record: { id: 'key-uuid-1', tier: 'user', dailyLimit: 1000 },
    });
    usersMock.insert.mockImplementation(async (rec: any) => stubInsertedUser({ id: rec.id, apiKeyId: rec.apiKeyId, username: rec.username, email: rec.email }));

    const result = await authService(fakeDb).register(validRegister);

    // username/email lowered
    expect(usersMock.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(usersMock.findByUsername).toHaveBeenCalledWith('alice');

    // api key minted with user tier + USER_DAILY_QUOTA from env
    expect(apiKeysMock.create).toHaveBeenCalledWith({
      name: 'alice-key',
      tier: 'user',
      dailyLimit: 1000,
    });

    // password is hashed (bcrypt format) before insert
    const insertArg = usersMock.insert.mock.calls[0]![0];
    expect(insertArg.username).toBe('alice');
    expect(insertArg.email).toBe('alice@example.com');
    expect(insertArg.apiKeyId).toBe('key-uuid-1');
    expect(insertArg.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(validRegister.password, insertArg.passwordHash)).toBe(true);

    // JWT returned & verifiable, no passwordHash leak
    expect(result.user).not.toHaveProperty('passwordHash');
    const payload = jwt.verify(result.token, process.env.JWT_SECRET!) as any;
    expect(payload.sub).toBe(insertArg.id);
    expect(payload.type).toBe('access');
  });

  it('rejects duplicate email', async () => {
    usersMock.findByEmail.mockResolvedValue({ id: 'x' });
    usersMock.findByUsername.mockResolvedValue(null);

    await expect(authService(fakeDb).register(validRegister)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(apiKeysMock.create).not.toHaveBeenCalled();
    expect(usersMock.insert).not.toHaveBeenCalled();
  });

  it('rejects duplicate username', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue({ id: 'x' });

    await expect(authService(fakeDb).register(validRegister)).rejects.toBeInstanceOf(AppError);
    expect(usersMock.insert).not.toHaveBeenCalled();
  });

  it('propagates failures from the user insert', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue(null);
    apiKeysMock.create.mockResolvedValue({ plaintext: 'rex_x', record: { id: 'k1' } });
    usersMock.insert.mockRejectedValue(new Error('db kaboom'));

    await expect(authService(fakeDb).register(validRegister)).rejects.toThrow('db kaboom');
  });
});

describe('authService.login', () => {
  const password = 'sup3rsecret!';
  let storedUser: any;

  beforeEach(async () => {
    storedUser = stubInsertedUser({ passwordHash: await bcrypt.hash(password, 4) });
  });

  it('logs in via email and returns a JWT', async () => {
    usersMock.findByEmail.mockResolvedValue(storedUser);
    usersMock.touchLogin.mockResolvedValue(undefined);

    const result = await authService(fakeDb).login({ identifier: 'alice@example.com', password });

    expect(usersMock.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(usersMock.findByUsername).not.toHaveBeenCalled();
    expect(usersMock.touchLogin).toHaveBeenCalledWith(storedUser.id);

    const payload = jwt.verify(result.token, process.env.JWT_SECRET!) as any;
    expect(payload.sub).toBe(storedUser.id);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.lastLoginAt).not.toBeNull();
  });

  it('logs in via username (lowercased)', async () => {
    usersMock.findByUsername.mockResolvedValue(storedUser);
    usersMock.touchLogin.mockResolvedValue(undefined);

    const result = await authService(fakeDb).login({ identifier: 'Alice', password });

    expect(usersMock.findByUsername).toHaveBeenCalledWith('alice');
    expect(usersMock.findByEmail).not.toHaveBeenCalled();
    expect(typeof result.token).toBe('string');
  });

  it('rejects unknown identifier with 401', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue(null);

    await expect(authService(fakeDb).login({ identifier: 'ghost', password })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
    expect(usersMock.touchLogin).not.toHaveBeenCalled();
  });

  it('rejects wrong password with 401 (no touchLogin)', async () => {
    usersMock.findByUsername.mockResolvedValue(storedUser);

    await expect(
      authService(fakeDb).login({ identifier: 'alice', password: 'wrong-password' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(usersMock.touchLogin).not.toHaveBeenCalled();
  });
});

describe('authService JWT', () => {
  it('issues tokens that decode with the configured secret and expire', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue(null);
    apiKeysMock.create.mockResolvedValue({ plaintext: 'rex_x', record: { id: 'k1' } });
    usersMock.insert.mockImplementation(async (r: any) => stubInsertedUser({ id: r.id, apiKeyId: r.apiKeyId }));

    const { token } = await authService(fakeDb).register(validRegister);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it('tokens fail verification with the wrong secret', async () => {
    usersMock.findByEmail.mockResolvedValue(null);
    usersMock.findByUsername.mockResolvedValue(null);
    apiKeysMock.create.mockResolvedValue({ plaintext: 'rex_x', record: { id: 'k1' } });
    usersMock.insert.mockImplementation(async (r: any) => stubInsertedUser({ id: r.id, apiKeyId: r.apiKeyId }));

    const { token } = await authService(fakeDb).register(validRegister);
    expect(() => jwt.verify(token, 'definitely-not-the-real-secret-xxxxx')).toThrow();
  });
});
