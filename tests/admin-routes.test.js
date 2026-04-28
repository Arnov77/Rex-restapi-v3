const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

let tmpRoot;
let store;
let auth;
let adminRouter;
let errorHandler;

function loadFresh() {
  const purge = (id) => delete require.cache[require.resolve(id)];
  purge('../src/shared/auth/apiKeyStore');
  purge('../src/shared/auth/apiKeyAuth');
  purge('../src/core/admin/admin.routes');
  purge('../src/core/admin/admin.controller');
  purge('../src/shared/middleware/errorHandler');
  store = require('../src/shared/auth/apiKeyStore');
  auth = require('../src/shared/auth/apiKeyAuth');
  adminRouter = require('../src/core/admin/admin.routes');
  ({ errorHandler } = require('../src/shared/middleware/errorHandler'));
  store._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-admin-'));
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(auth.apiKeyAuth);
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

describe('admin routes', () => {
  it('requires master key (anon → 403)', async () => {
    const res = await request(buildApp()).get('/api/admin/keys');
    expect(res.status).toBe(403);
  });

  it('user-tier key is rejected by /api/admin', async () => {
    const userKey = store.createKey({ name: 'u', tier: 'user' }).plaintext;
    const res = await request(buildApp()).get('/api/admin/keys').set('X-API-Key', userKey);
    expect(res.status).toBe(403);
  });

  it('master can list, create, and revoke keys', async () => {
    const masterKey = store.createKey({ name: 'm', tier: 'master' }).plaintext;
    const app = buildApp();

    const listEmpty = await request(app).get('/api/admin/keys').set('X-API-Key', masterKey);
    expect(listEmpty.status).toBe(200);
    expect(listEmpty.body.data.total).toBe(1);

    const created = await request(app)
      .post('/api/admin/keys')
      .set('X-API-Key', masterKey)
      .send({ name: 'mobile-app', tier: 'user' });
    expect(created.status).toBe(201);
    expect(created.body.data.key).toMatch(/^rex_/);
    expect(created.body.data.id).toBeDefined();
    const newId = created.body.data.id;
    const newKey = created.body.data.key;
    expect(store.verifyKey(newKey)?.id).toBe(newId);

    const list = await request(app).get('/api/admin/keys').set('X-API-Key', masterKey);
    expect(list.body.data.total).toBe(2);
    for (const entry of list.body.data.keys) expect(entry.keyHash).toBeUndefined();

    const revoke = await request(app)
      .delete(`/api/admin/keys/${newId}`)
      .set('X-API-Key', masterKey);
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);
    expect(store.verifyKey(newKey)).toBeNull();
  });

  it('rejects invalid create payload', async () => {
    const masterKey = store.createKey({ name: 'm', tier: 'master' }).plaintext;
    const res = await request(buildApp())
      .post('/api/admin/keys')
      .set('X-API-Key', masterKey)
      .send({ tier: 'user' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when revoking unknown id', async () => {
    const masterKey = store.createKey({ name: 'm', tier: 'master' }).plaintext;
    const res = await request(buildApp())
      .delete('/api/admin/keys/00000000-0000-0000-0000-000000000000')
      .set('X-API-Key', masterKey);
    expect(res.status).toBe(404);
  });
});
