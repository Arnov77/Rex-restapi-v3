const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

let tmpRoot;
let app;

function buildApp() {
  delete require.cache[require.resolve('../src/shared/auth/usersStore')];
  delete require.cache[require.resolve('../src/shared/auth/apiKeyStore')];
  delete require.cache[require.resolve('../src/shared/auth/jwt')];
  delete require.cache[require.resolve('../src/shared/auth/verifyToken')];
  delete require.cache[require.resolve('../src/shared/auth/apiKeyAuth')];
  delete require.cache[require.resolve('../src/shared/middleware/loginLimiter')];
  delete require.cache[require.resolve('../src/shared/middleware/registerLimiter')];
  delete require.cache[require.resolve('../src/core/auth/auth.routes')];
  delete require.cache[require.resolve('../src/core/auth/auth.controller')];
  delete require.cache[require.resolve('../src/core/user/user.routes')];
  delete require.cache[require.resolve('../src/core/user/user.controller')];
  require('../src/shared/auth/usersStore')._resetForTests();
  require('../src/shared/auth/apiKeyStore')._resetForTests();
  require('../src/shared/auth/jwt')._resetForTests();

  const { errorHandler } = require('../src/shared/middleware/errorHandler');
  const authRoute = require('../src/core/auth/auth.routes');
  const userRoute = require('../src/core/user/user.routes');

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoute);
  app.use('/api/user', userRoute);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-authrt-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  process.env.BCRYPT_ROUNDS = '8';
  process.env.JWT_SECRET = 'x'.repeat(64);
  // Bump register cap above the test count so per-IP throttle doesn't
  // interfere; supertest reuses 127.0.0.1 across all calls in a test file.
  process.env.REGISTER_LIMIT_PER_IP = '100';
  buildApp();
});

afterEach(() => {
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.unlinkSync(realDataDir);
  }
  const backup = path.join(__dirname, '..', `data.bak-${process.pid}`);
  if (fs.existsSync(backup)) fs.renameSync(backup, realDataDir);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/auth/register', () => {
  it('creates user + API key + JWT, exposes plaintext key', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@x.com', password: 'hunter22pass' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.username).toBe('alice');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.apiKey.key).toMatch(/^rex_/);
    expect(res.body.data.apiKey.tier).toBe('user');
    expect(res.body.data.token.split('.')).toHaveLength(3);
  });

  it('rejects duplicate email with 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice2', email: 'a@x.com', password: 'hunter22pass' });

    expect(res.status).toBe(409);
  });

  it('rejects weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
  });

  it('accepts username + email', async () => {
    const byUsername = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'hunter22pass' });
    expect(byUsername.status).toBe(200);
    expect(byUsername.body.data.token.split('.')).toHaveLength(3);

    const byEmail = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'a@x.com', password: 'hunter22pass' });
    expect(byEmail.status).toBe(200);
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/user/profile', () => {
  it('requires bearer token', async () => {
    const res = await request(app).get('/api/user/profile');
    expect(res.status).toBe(401);
  });

  it('returns user + apiKey metadata (no plaintext) + usage when JWT is valid', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
    const token = reg.body.data.token;

    const res = await request(app).get('/api/user/profile').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('alice');
    // Plaintext is intentionally NOT shipped by /profile — JWT theft alone
    // must not leak the API key. Plaintext is delivered at register / login
    // / regenerate-key / reveal-key (password re-auth) only.
    expect(res.body.data.apiKey.key).toBeNull();
    expect(res.body.data.apiKey.id).toBeTruthy();
    expect(res.body.data.usage.limit).toBeGreaterThan(0);
  });

  it('rejects rex_ Bearer (which is an API key, not a JWT)', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
    const apiKey = reg.body.data.apiKey.key;

    const res = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/user/regenerate-key', () => {
  it('revokes the old key and issues a new plaintext one', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
    const token = reg.body.data.token;
    const oldKey = reg.body.data.apiKey.key;

    const res = await request(app)
      .post('/api/user/regenerate-key')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.apiKey.key).toMatch(/^rex_/);
    expect(res.body.data.apiKey.key).not.toBe(oldKey);

    // /profile no longer returns plaintext; verify metadata reflects new id.
    const profile = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(profile.body.data.apiKey.id).toBe(res.body.data.apiKey.id);
    expect(profile.body.data.apiKey.key).toBeNull();
  });

  it("preserves today's used quota across regenerate (anti-abuse)", async () => {
    const usageStore = require('../src/shared/auth/usageStore');
    usageStore._resetForTests();
    usageStore.start({ flushIntervalSec: 9999 });

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
    const token = reg.body.data.token;
    const userId = reg.body.data.user.id;

    // Simulate 5 paid hits — quota is keyed per-user, not per-key, so the
    // counter survives regenerate without an explicit transfer call.
    usageStore.increment(`user:${userId}`);
    usageStore.increment(`user:${userId}`);
    usageStore.increment(`user:${userId}`);
    usageStore.increment(`user:${userId}`);
    usageStore.increment(`user:${userId}`);

    await request(app).post('/api/user/regenerate-key').set('Authorization', `Bearer ${token}`);

    expect(usageStore.getCount(`user:${userId}`)).toBe(5);

    const profile = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(profile.body.data.usage.used).toBe(5);
    expect(profile.body.data.usage.remaining).toBe(profile.body.data.usage.limit - 5);

    usageStore.stop();
  });
});
