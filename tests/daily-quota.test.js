const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

let tmpRoot;
let apiKeyStore;
let usageStore;
let apiKeyAuth;
let dailyQuota;

function loadFresh() {
  const purge = (id) => delete require.cache[require.resolve(id)];
  purge('../src/shared/auth/apiKeyStore');
  purge('../src/shared/auth/usageStore');
  purge('../src/shared/auth/apiKeyAuth');
  purge('../src/shared/middleware/dailyQuota');
  apiKeyStore = require('../src/shared/auth/apiKeyStore');
  usageStore = require('../src/shared/auth/usageStore');
  apiKeyAuth = require('../src/shared/auth/apiKeyAuth');
  ({ dailyQuota } = require('../src/shared/middleware/dailyQuota'));
  apiKeyStore._resetForTests();
  usageStore._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-quota-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  loadFresh();
  usageStore.start({ flushIntervalSec: 600 });
});

afterEach(() => {
  if (usageStore) usageStore.stop();
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
  app.set('trust proxy', false);
  app.use(express.json());
  app.use(apiKeyAuth.apiKeyAuth);
  app.use(dailyQuota);
  app.get('/x', (req, res) => res.json({ ok: true }));
  return app;
}

async function hammer(agent, requests) {
  const out = [];
  for (let i = 0; i < requests; i++) out.push(await agent());
  return out;
}

describe('dailyQuota', () => {
  it('master tier bypasses entirely', async () => {
    const masterKey = apiKeyStore.createKey({ name: 'm', tier: 'master' }).plaintext;
    const app = buildApp();
    const responses = await hammer(() => request(app).get('/x').set('X-API-Key', masterKey), 50);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(responses[0].headers['x-quota-limit']).toBeUndefined();
  });

  it('user tier consumes from per-key quota and 429s when exhausted', async () => {
    const { plaintext } = apiKeyStore.createKey({ name: 'u', tier: 'user', dailyLimit: 3 });
    const app = buildApp();
    const responses = await hammer(() => request(app).get('/x').set('X-API-Key', plaintext), 5);
    expect(responses.slice(0, 3).every((r) => r.status === 200)).toBe(true);
    expect(responses[2].headers['x-quota-remaining']).toBe('0');
    expect(responses[3].status).toBe(429);
    expect(responses[3].body.message).toMatch(/Daily quota exceeded/);
  });

  it('anon tier uses default env limit, bucketed by IP hash', async () => {
    process.env.QUOTA_ANON_DAILY = '2';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../src/shared/middleware/dailyQuota')];
    ({ dailyQuota } = require('../src/shared/middleware/dailyQuota'));

    const app = buildApp();
    const r1 = await request(app).get('/x');
    const r2 = await request(app).get('/x');
    const r3 = await request(app).get('/x');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);

    delete process.env.QUOTA_ANON_DAILY;
  });

  it('exposes X-Quota-* headers on every response', async () => {
    const { plaintext } = apiKeyStore.createKey({ name: 'h', tier: 'user', dailyLimit: 10 });
    const res = await request(buildApp()).get('/x').set('X-API-Key', plaintext);
    expect(res.status).toBe(200);
    expect(res.headers['x-quota-limit']).toBe('10');
    expect(res.headers['x-quota-remaining']).toBe('9');
    expect(res.headers['x-quota-reset']).toBeDefined();
    expect(new Date(res.headers['x-quota-reset']).toString()).not.toBe('Invalid Date');
  });

  it('per-key dailyLimit override beats env default', async () => {
    const { plaintext } = apiKeyStore.createKey({ name: 'tiny', tier: 'user', dailyLimit: 1 });
    const app = buildApp();
    const ok = await request(app).get('/x').set('X-API-Key', plaintext);
    const blocked = await request(app).get('/x').set('X-API-Key', plaintext);
    expect(ok.status).toBe(200);
    expect(blocked.status).toBe(429);
  });
});
