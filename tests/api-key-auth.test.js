const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

let tmpRoot;
let store;
let auth;

function loadFresh() {
  delete require.cache[require.resolve('../src/shared/auth/apiKeyStore')];
  delete require.cache[require.resolve('../src/shared/auth/apiKeyAuth')];
  store = require('../src/shared/auth/apiKeyStore');
  auth = require('../src/shared/auth/apiKeyAuth');
  store._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-auth-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  loadFresh();
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

function makeApp() {
  const app = express();
  app.use(auth.apiKeyAuth);
  app.get('/probe', (req, res) =>
    res.json({ tier: req.apiKey?.tier ?? 'anon', id: req.apiKey?.id ?? null })
  );
  app.get('/master-only', auth.requireMaster, (req, res) => res.json({ ok: true }));
  return app;
}

describe('apiKeyAuth middleware', () => {
  it('passes anon (no key) through with req.apiKey=null', async () => {
    const res = await request(makeApp()).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tier: 'anon', id: null });
  });

  it('rejects bad-format key', async () => {
    const res = await request(makeApp()).get('/probe').set('X-API-Key', 'not-rex-format');
    expect(res.status).toBe(401);
  });

  it('rejects unknown key', async () => {
    const res = await request(makeApp())
      .get('/probe')
      .set('X-API-Key', 'rex_definitelyNotInTheStore');
    expect(res.status).toBe(401);
  });

  it('accepts a valid user key (X-API-Key)', async () => {
    const { plaintext, record } = store.createKey({ name: 'mobile', tier: 'user' });
    const res = await request(makeApp()).get('/probe').set('X-API-Key', plaintext);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tier: 'user', id: record.id });
  });

  it('accepts a valid key via Authorization: Bearer', async () => {
    const { plaintext } = store.createKey({ name: 'bot', tier: 'user' });
    const res = await request(makeApp()).get('/probe').set('Authorization', `Bearer ${plaintext}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('user');
  });

  it('rejects revoked key with 401', async () => {
    const { plaintext, record } = store.createKey({ name: 'old', tier: 'user' });
    store.revokeKey(record.id);
    const res = await request(makeApp()).get('/probe').set('X-API-Key', plaintext);
    expect(res.status).toBe(401);
  });

  it('requireMaster blocks anon and user, allows master', async () => {
    const userKey = store.createKey({ name: 'u', tier: 'user' }).plaintext;
    const masterKey = store.createKey({ name: 'm', tier: 'master' }).plaintext;
    const app = makeApp();

    const anonRes = await request(app).get('/master-only');
    expect(anonRes.status).toBe(403);

    const userRes = await request(app).get('/master-only').set('X-API-Key', userKey);
    expect(userRes.status).toBe(403);

    const masterRes = await request(app).get('/master-only').set('X-API-Key', masterKey);
    expect(masterRes.status).toBe(200);
    expect(masterRes.body).toEqual({ ok: true });
  });
});
