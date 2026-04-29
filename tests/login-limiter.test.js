const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

let tmpRoot;

function buildApp() {
  delete require.cache[require.resolve('../src/shared/auth/usersStore')];
  delete require.cache[require.resolve('../src/shared/auth/apiKeyStore')];
  delete require.cache[require.resolve('../src/shared/auth/jwt')];
  delete require.cache[require.resolve('../src/shared/middleware/loginLimiter')];
  delete require.cache[require.resolve('../src/shared/middleware/registerLimiter')];
  delete require.cache[require.resolve('../src/core/auth/auth.routes')];
  delete require.cache[require.resolve('../src/core/auth/auth.controller')];
  require('../src/shared/auth/usersStore')._resetForTests();
  require('../src/shared/auth/apiKeyStore')._resetForTests();
  require('../src/shared/auth/jwt')._resetForTests();

  const { errorHandler } = require('../src/shared/middleware/errorHandler');
  const authRoute = require('../src/core/auth/auth.routes');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoute);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-loginlim-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  process.env.BCRYPT_ROUNDS = '8';
  process.env.JWT_SECRET = 'x'.repeat(64);
  process.env.REGISTER_LIMIT_PER_IP = '100';
});

afterEach(() => {
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.unlinkSync(realDataDir);
  }
  const backup = path.join(__dirname, '..', `data.bak-${process.pid}`);
  if (fs.existsSync(backup)) fs.renameSync(backup, realDataDir);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.LOGIN_LIMIT_PER_IP;
  delete process.env.LOGIN_LIMIT_PER_IDENTIFIER;
});

describe('loginLimiter', () => {
  it('blocks brute-force attempts against a single account after the per-identifier cap', async () => {
    process.env.LOGIN_LIMIT_PER_IP = '100';
    process.env.LOGIN_LIMIT_PER_IDENTIFIER = '3';
    const app = buildApp();
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });

    // First 3 wrong-password attempts return 401 (limiter accepts them).
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'alice', password: 'wrong' });
      expect(res.status).toBe(401);
    }
    // 4th attempt against the same identifier is throttled.
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Akun ini terlalu banyak/);
  });

  it('does NOT consume budget on successful logins', async () => {
    process.env.LOGIN_LIMIT_PER_IP = '100';
    process.env.LOGIN_LIMIT_PER_IDENTIFIER = '3';
    const app = buildApp();
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });

    // 10 successful logins in a row: should all succeed (skipSuccessfulRequests).
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'alice', password: 'hunter22pass' });
      expect(res.status).toBe(200);
    }
  });

  it('caps total failed attempts per IP independently of identifier', async () => {
    process.env.LOGIN_LIMIT_PER_IP = '4';
    process.env.LOGIN_LIMIT_PER_IDENTIFIER = '100';
    const app = buildApp();
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });

    // Spread 4 failures across different identifiers — IP limiter should still kick in.
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: `random${i}`, password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'yetanother', password: 'wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/IP ini/);
  });
});
