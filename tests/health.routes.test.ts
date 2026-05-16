import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';

// /api/ready probes both Supabase and the headless browser. We mock both
// so the test can drive every combination of up/down without spinning up
// a real Chromium or Postgres.

const browserMock = {
  isConnected: vi.fn(() => true),
};

vi.mock('../src/shared/browser/browserManager.js', () => ({
  // Tests resolve to a fake browser whose `isConnected` we control.
  getBrowser: vi.fn(async () => browserMock),
}));

// State the supabase shim returns. Mutated per-test via `setDbError`.
let dbError: unknown = null;

vi.mock('../src/plugins/supabase.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(
      async (app: FastifyInstance) => {
        // Mimic only the chain `/ready` walks:
        //   app.supabase.from('users').select('id').limit(1)
        // …then awaits and reads `error`.
        app.decorate('supabase', {
          from: () => ({
            select: () => ({
              limit: async () => ({ error: dbError }),
            }),
          }),
        } as any);
      },
      { name: 'supabase' },
    ),
  };
});

const supabasePlugin = (await import('../src/plugins/supabase.js')).default;
const errorHandler = (await import('../src/plugins/errorHandler.js')).default;
const healthRoutes = (await import('../src/modules/health/health.routes.js')).default;
const browserManager = await import('../src/shared/browser/browserManager.js');

let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  const a = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  a.setValidatorCompiler(validatorCompiler);
  a.setSerializerCompiler(serializerCompiler);
  await a.register(errorHandler);
  await a.register(supabasePlugin);
  await a.register(healthRoutes, { prefix: '/api' });
  await a.ready();
  return a;
}

beforeEach(async () => {
  dbError = null;
  browserMock.isConnected.mockReset().mockReturnValue(true);
  (browserManager.getBrowser as any).mockReset().mockResolvedValue(browserMock);
  app = await buildTestApp();
});

afterEach(async () => {
  if (app) await app.close();
});

describe('GET /api/health', () => {
  it('returns 200 with uptime and version (no dep checks)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.version).toBe('string');
  });
});

describe('GET /api/ready', () => {
  it('returns 200 with both deps up when supabase + browser respond cleanly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: 'up', browser: 'up' });
  });

  it('returns 503 when supabase reports an error (browser still up)', async () => {
    dbError = { message: 'connection refused' };
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down', browser: 'up' });
  });

  it('returns 503 when browser launch fails (db still up)', async () => {
    (browserManager.getBrowser as any).mockRejectedValueOnce(new Error('chromium missing'));
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'up', browser: 'down' });
  });

  it('returns 503 when browser is reachable but disconnected', async () => {
    browserMock.isConnected.mockReturnValueOnce(false);
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'up', browser: 'down' });
  });

  it('reports both deps down independently (no short-circuit)', async () => {
    dbError = { message: 'down' };
    (browserManager.getBrowser as any).mockRejectedValueOnce(new Error('also down'));
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down', browser: 'down' });
  });
});
