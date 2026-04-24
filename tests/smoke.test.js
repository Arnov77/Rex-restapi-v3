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
