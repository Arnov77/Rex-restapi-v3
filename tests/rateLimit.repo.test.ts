import './setupEnv.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimitRepo } from '../src/modules/rateLimit/rateLimit.repo.js';

function makeDb(rpcImpl: (name: string, args: any) => Promise<{ data: any; error: any }>) {
  return { rpc: vi.fn(rpcImpl) } as any;
}

describe('rateLimitRepo.hit', () => {
  it('calls the RPC with sanitized args and maps the row', async () => {
    const resetIso = new Date(Date.now() + 60_000).toISOString();
    const db = makeDb(async () => ({
      data: [{ allowed: true, count: 3, reset_at: resetIso }],
      error: null,
    }));
    const repo = rateLimitRepo(db);
    const out = await repo.hit('bucket', 60.7, 10.9);

    expect(db.rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: 'bucket',
      p_window_s: 60,
      p_max: 10,
    });
    expect(out).toEqual({ allowed: true, count: 3, resetAt: new Date(resetIso) });
  });

  it('floors window/max and enforces minimums (window>=1, max>=0)', async () => {
    const db = makeDb(async () => ({
      data: { allowed: true, count: 0, reset_at: new Date().toISOString() },
      error: null,
    }));
    const repo = rateLimitRepo(db);
    await repo.hit('k', 0, -5);
    expect(db.rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: 'k',
      p_window_s: 1,
      p_max: 0,
    });
  });

  it('throws Internal when the RPC returns an error', async () => {
    const db = makeDb(async () => ({ data: null, error: { message: 'boom' } }));
    await expect(rateLimitRepo(db).hit('k', 60, 5)).rejects.toThrow(/rateLimit\.hit: boom/);
  });

  it('throws Internal when the RPC returns no row', async () => {
    const db = makeDb(async () => ({ data: null, error: null }));
    await expect(rateLimitRepo(db).hit('k', 60, 5)).rejects.toThrow(/empty result/);
  });
});

describe('rateLimitRepo.gc', () => {
  it('calls RPC with default interval and returns deleted count', async () => {
    const db = makeDb(async () => ({ data: 17, error: null }));
    const n = await rateLimitRepo(db).gc();
    expect(db.rpc).toHaveBeenCalledWith('rate_limit_gc', { p_older_than: '1 day' });
    expect(n).toBe(17);
  });

  it('throws Internal on RPC error', async () => {
    const db = makeDb(async () => ({ data: null, error: { message: 'nope' } }));
    await expect(rateLimitRepo(db).gc()).rejects.toThrow(/rateLimit\.gc: nope/);
  });
});
