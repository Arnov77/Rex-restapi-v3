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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-reveal-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  process.env.BCRYPT_ROUNDS = '8';
  process.env.JWT_SECRET = 'x'.repeat(64);
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

describe('POST /api/user/reveal-key', () => {
  async function setup() {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });
    return {
      token: reg.body.data.token,
      plaintext: reg.body.data.apiKey.key,
    };
  }

  it('requires JWT', async () => {
    const res = await request(app).post('/api/user/reveal-key').send({ password: 'hunter22pass' });
    expect(res.status).toBe(401);
  });

  it('rejects wrong password with 401', async () => {
    const { token } = await setup();
    const res = await request(app)
      .post('/api/user/reveal-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrong-password-99' });
    expect(res.status).toBe(401);
  });

  it('returns the plaintext API key when password is correct', async () => {
    const { token, plaintext } = await setup();
    const res = await request(app)
      .post('/api/user/reveal-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'hunter22pass' });
    expect(res.status).toBe(200);
    expect(res.body.data.apiKey.key).toBe(plaintext);
  });

  it('returns the new key after regenerate', async () => {
    const { token } = await setup();

    const regen = await request(app)
      .post('/api/user/regenerate-key')
      .set('Authorization', `Bearer ${token}`);
    const newKey = regen.body.data.apiKey.key;

    const reveal = await request(app)
      .post('/api/user/reveal-key')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'hunter22pass' });
    expect(reveal.status).toBe(200);
    expect(reveal.body.data.apiKey.key).toBe(newKey);
  });
});

describe('POST /api/auth/login (now ships plaintext API key)', () => {
  it('includes apiKey.key in the response', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'a@x.com', password: 'hunter22pass' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'hunter22pass' });
    expect(res.status).toBe(200);
    expect(res.body.data.apiKey.key).toMatch(/^rex_/);
    expect(res.body.data.apiKey.tier).toBe('user');
  });
});
