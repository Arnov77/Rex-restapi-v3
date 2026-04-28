const express = require('express');
const request = require('supertest');

const { tieredLimiter } = require('../src/shared/middleware/tieredLimiter');

function buildApp({ anonMax, userMax, simulatedTier = null, simulatedId = 'fixed-id' }) {
  const app = express();
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    if (simulatedTier) {
      req.apiKey = { id: simulatedId, name: 't', tier: simulatedTier };
    } else {
      req.apiKey = null;
    }
    next();
  });
  app.use(tieredLimiter({ anonMax, userMax, windowMs: 60_000 }));
  app.get('/x', (req, res) => res.json({ ok: true }));
  return app;
}

async function hammer(app, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const res = await request(app).get('/x');
    results.push(res.status);
  }
  return results;
}

describe('tieredLimiter', () => {
  it('caps anon at anonMax', async () => {
    const app = buildApp({ anonMax: 3, userMax: 10 });
    const codes = await hammer(app, 5);
    expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
  });

  it('caps user at userMax (higher than anon)', async () => {
    const app = buildApp({ anonMax: 2, userMax: 5, simulatedTier: 'user' });
    const codes = await hammer(app, 7);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
  });

  it('master bypasses the limiter entirely', async () => {
    const app = buildApp({ anonMax: 1, userMax: 1, simulatedTier: 'master' });
    const codes = await hammer(app, 20);
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});
