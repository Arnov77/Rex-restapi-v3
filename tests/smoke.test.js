// Vitest globals (describe/it/expect) are enabled via vitest.config.js — no
// require('vitest') here since this project is CommonJS and vitest v4+ is ESM.
const express = require('express');
const request = require('supertest');

// Smoke tests that verify every route module is loadable and exports an
// Express router. This catches import-time errors (missing files, broken
// requires, syntax issues) without needing to boot the full server.

const routeModules = [
  '../src/core/media/youtube/youtube.routes',
  '../src/core/media/brat/brat.routes',
  '../src/core/media/tiktok/tiktok.routes',
  '../src/core/media/instagram/instagram.routes',
  '../src/core/tools/gdrive/gdrive.routes',
  '../src/core/tools/quote/quote.routes',
  '../src/core/tools/smeme/smeme.routes',
  '../src/core/tools/promosi/promosi.routes',
  '../src/core/tools/mcprofile/mcprofile.routes',
  '../src/core/tools/miq/miq.routes',
  '../src/core/tools/telegram/telegram.routes',
];

describe('route modules', () => {
  it.each(routeModules)('%s loads and exports an Express router', (modulePath) => {
    const router = require(modulePath);
    expect(router).toBeDefined();
    // Express routers are functions with a `stack` array of layers.
    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
  });
});

describe('relocated modules (PR-4 merger)', () => {
  it('browserManager exposes pool API', () => {
    const bm = require('../src/shared/browser/browserManager');
    for (const fn of ['getBrowser', 'withContext', 'withPage', 'shutdown']) {
      expect(typeof bm[fn]).toBe('function');
    }
  });

  it('brat playwright + color helpers are reachable', () => {
    const { generateBrat, generateBratVideo } = require('../src/core/media/brat/brat.playwright');
    const { initColorIndex, convertColor } = require('../src/core/media/brat/color');
    expect(typeof generateBrat).toBe('function');
    expect(typeof generateBratVideo).toBe('function');
    expect(typeof initColorIndex).toBe('function');
    expect(typeof convertColor).toBe('function');
  });

  it('quote playwright is reachable', () => {
    const { generateQuoteImage } = require('../src/core/tools/quote/quote.playwright');
    expect(typeof generateQuoteImage).toBe('function');
  });

  it('promosi service is reachable', () => {
    const { promotionDetector } = require('../src/core/tools/promosi/promosi.service');
    expect(typeof promotionDetector).toBe('function');
  });

  it('shared media gif + shared utils upload are reachable', () => {
    const { createGIF } = require('../src/shared/media/gif');
    const upload = require('../src/shared/utils/upload');
    expect(typeof createGIF).toBe('function');
    for (const fn of ['uploadToTmpfiles', 'uploadToDiscordWebhook', 'fetchRemoteImage']) {
      expect(typeof upload[fn]).toBe('function');
    }
  });
});

describe('shared utilities', () => {
  it('logger exposes expected methods', () => {
    const logger = require('../src/shared/utils/logger');
    for (const method of ['info', 'warn', 'error', 'debug', 'success']) {
      expect(typeof logger[method]).toBe('function');
    }
  });

  it('ResponseHandler has success/error helpers', () => {
    const ResponseHandler = require('../src/shared/utils/response');
    expect(typeof ResponseHandler.success).toBe('function');
    expect(typeof ResponseHandler.error).toBe('function');
  });

  it('errorHandler is a 4-arg middleware', () => {
    const { errorHandler } = require('../src/shared/middleware/errorHandler');
    expect(typeof errorHandler).toBe('function');
    expect(errorHandler.length).toBe(4);
  });
});

describe('supertest wiring', () => {
  // Proves supertest works against a mounted router without booting server.js.
  it('responds to a trivially-mounted route', async () => {
    const app = express();
    app.get('/__ping', (req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get('/__ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('server app (end-to-end wiring)', () => {
  const app = require('../server');

  it('GET /health returns the standard envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: expect.any(String),
      data: { status: 'healthy' },
    });
  });

  it('GET /api/status reports environment + version', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      version: expect.any(String),
      environment: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it('responds with a stable request-id header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('echoes an incoming X-Request-ID header', async () => {
    const incoming = 'test-req-id-42';
    const res = await request(app).get('/health').set('X-Request-ID', incoming);
    expect(res.headers['x-request-id']).toBe(incoming);
  });

  it('applies helmet security headers', async () => {
    const res = await request(app).get('/health');
    // helmet sets a handful of hardening headers; pick two that are always on
    // regardless of helmet's internal defaults.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).toHaveProperty('x-dns-prefetch-control');
  });

  it('returns 404 envelope on unknown endpoint', async () => {
    const res = await request(app).get('/__definitely-not-a-route__');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, statusCode: 404 });
  });

  it('rejects malformed JSON with a 400 envelope', async () => {
    const res = await request(app)
      .post('/api/brat/generate')
      .set('Content-Type', 'application/json')
      .send('{"not valid json');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400 });
  });
});
