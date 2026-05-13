import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Mocks ────────────────────────────────────────────────────────────────

const rateLimitRepoMock = {
  hit: vi.fn(),
  gc: vi.fn().mockResolvedValue(0),
};

vi.mock('../src/plugins/supabase.js', async () => {
  const fp = (await import('fastify-plugin')).default;
  return {
    default: fp(async (app: FastifyInstance) => {
      app.decorate('supabase', {} as any);
    }, { name: 'supabase' }),
  };
});

vi.mock('../src/modules/rateLimit/rateLimit.repo.js', () => ({
  rateLimitRepo: () => rateLimitRepoMock,
}));

const supabasePlugin = (await import('../src/plugins/supabase.js')).default;
const errorHandler = (await import('../src/plugins/errorHandler.js')).default;
const rateLimitPlugin = (await import('../src/plugins/rateLimit.js')).default;

async function buildApp(opts: {
  windowSec?: number;
  max?: number;
  keyGenerator?: (req: any) => string | null;
  skip?: (req: any) => boolean;
  prefix?: string;
  message?: string;
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(errorHandler);
  await app.register(supabasePlugin);
  await app.register(rateLimitPlugin);

  app.get(
    '/ping',
    {
      preHandler: [
        app.rateLimit({
          windowSec: opts.windowSec ?? 60,
          max: opts.max ?? 5,
          prefix: opts.prefix ?? 'test',
          keyGenerator: opts.keyGenerator ?? ((req) => req.ip),
          skip: opts.skip,
          message: opts.message,
        }),
      ],
    },
    async () => ({ ok: true }),
  );

  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(() => {
  rateLimitRepoMock.hit.mockReset();
  rateLimitRepoMock.gc.mockReset().mockResolvedValue(0);
});

afterEach(async () => {
  if (app) await app.close();
});

describe('rateLimit plugin — basic flow', () => {
  it('allows the request and sets RateLimit-* headers when under quota', async () => {
    const resetAt = new Date(Date.now() + 30_000);
    rateLimitRepoMock.hit.mockResolvedValue({ allowed: true, count: 1, resetAt });
    app = await buildApp({ max: 5, windowSec: 60 });

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
    expect(res.headers['ratelimit-remaining']).toBe('4');
    expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThanOrEqual(0);
  });

  it('forwards the bucket key (prefix:subKey) and window/max to the repo', async () => {
    rateLimitRepoMock.hit.mockResolvedValue({ allowed: true, count: 1, resetAt: new Date() });
    app = await buildApp({
      max: 7,
      windowSec: 30,
      prefix: 'login',
      keyGenerator: () => 'user-42',
    });

    await app.inject({ method: 'GET', url: '/ping' });
    expect(rateLimitRepoMock.hit).toHaveBeenCalledWith('login:user-42', 30, 7);
  });

  it('returns 429 with the configured message when the repo says blocked', async () => {
    rateLimitRepoMock.hit.mockResolvedValue({
      allowed: false,
      count: 6,
      resetAt: new Date(Date.now() + 60_000),
    });
    app = await buildApp({ max: 5, message: 'Slow down, friend' });

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error?.message ?? body.message).toBe('Slow down, friend');
    // Remaining clamps to 0 (count > max).
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });

  it('clamps Remaining to 0 even if count exceeds max', async () => {
    rateLimitRepoMock.hit.mockResolvedValue({
      allowed: false,
      count: 999,
      resetAt: new Date(Date.now() + 1_000),
    });
    app = await buildApp({ max: 3 });

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });
});

describe('rateLimit plugin — skip & null key', () => {
  it('skips entirely when skip() returns true (no repo call)', async () => {
    app = await buildApp({ skip: () => true });
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(rateLimitRepoMock.hit).not.toHaveBeenCalled();
  });

  it('skips when keyGenerator returns null (e.g. anon endpoint with no IP)', async () => {
    app = await buildApp({ keyGenerator: () => null });
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(rateLimitRepoMock.hit).not.toHaveBeenCalled();
  });
});

describe('rateLimit plugin — fail-open on repo error', () => {
  it('allows the request through and logs when the RPC throws', async () => {
    rateLimitRepoMock.hit.mockRejectedValue(new Error('supabase down'));
    app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('does NOT swallow AppError-like throws (they have statusCode and must propagate)', async () => {
    // Simulate a structured error bubbling up — e.g. caller throws
    // TooManyRequests directly. The plugin should re-throw, not fail-open.
    const err: any = new Error('blocked');
    err.statusCode = 429;
    rateLimitRepoMock.hit.mockRejectedValue(err);
    app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(429);
  });
});

describe('rateLimit plugin — per-tier key generators', () => {
  it('isolates buckets when keyGenerator differentiates tiers', async () => {
    rateLimitRepoMock.hit.mockResolvedValue({ allowed: true, count: 1, resetAt: new Date() });
    app = await buildApp({
      prefix: 'api',
      keyGenerator: (req) => {
        const tier = (req.headers['x-tier'] as string) ?? 'anon';
        return `${tier}:${req.ip}`;
      },
    });

    await app.inject({ method: 'GET', url: '/ping', headers: { 'x-tier': 'user' } });
    await app.inject({ method: 'GET', url: '/ping', headers: { 'x-tier': 'master' } });

    const buckets = rateLimitRepoMock.hit.mock.calls.map((c) => c[0]);
    expect(buckets[0]).toMatch(/^api:user:/);
    expect(buckets[1]).toMatch(/^api:master:/);
    expect(buckets[0]).not.toBe(buckets[1]);
  });
});
