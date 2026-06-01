import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock playwright-core ─────────────────────────────────────────────────

type Listener = () => void;

function makePage() {
  return {
    _kind: 'page',
    // Pooled withPage sets the viewport per-acquire and closes the page on release.
    setViewportSize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function makeContext() {
  const ctx: any = {
    _kind: 'context',
    newPage: vi.fn(async () => makePage()),
    // Pool clears cookies on release instead of closing the context (reuse).
    clearCookies: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return ctx;
}

function makeBrowser() {
  const listeners: Record<string, Listener[]> = {};
  const browser: any = {
    _kind: 'browser',
    newContext: vi.fn(async (_opts: any) => makeContext()),
    close: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: Listener) => {
      (listeners[event] ||= []).push(cb);
    }),
    _emit: (event: string) => {
      (listeners[event] || []).forEach((cb) => cb());
    },
  };
  return browser;
}

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (...args: any[]) => launchMock(...args),
  },
}));

// Import AFTER mock registration.
const browserModule = await import('../src/shared/browser/browserManager.js');
const { getBrowser, withContext, withPage, shutdown, __resetForTests } = browserModule;

beforeEach(() => {
  launchMock.mockReset();
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
});

describe('browserManager', () => {
  describe('getBrowser', () => {
    it('launches Chromium once and reuses the instance', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      const a = await getBrowser();
      const b = await getBrowser();

      expect(a).toBe(browser);
      expect(b).toBe(browser);
      expect(launchMock).toHaveBeenCalledTimes(1);
    });

    it('passes headless + sandbox-disabled args', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      await getBrowser();

      const opts = launchMock.mock.calls[0]![0];
      expect(opts.headless).toBe(true);
      expect(opts.args).toEqual(
        expect.arrayContaining(['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'])
      );
    });

    it('uses CHROME_BIN when env override is set', async () => {
      const prev = process.env.CHROME_BIN;
      process.env.CHROME_BIN = '/usr/bin/chromium-test';
      // Force loadEnv re-read by clearing its module cache.
      vi.resetModules();
      const localLaunch = vi.fn();
      vi.doMock('playwright-core', () => ({
        chromium: { launch: (...a: any[]) => localLaunch(...a) },
      }));
      const fresh = await import('../src/shared/browser/browserManager.js');
      const browser = makeBrowser();
      localLaunch.mockResolvedValue(browser);

      await fresh.getBrowser();

      expect(localLaunch.mock.calls[0]![0].executablePath).toBe('/usr/bin/chromium-test');

      // cleanup
      vi.doUnmock('playwright-core');
      vi.resetModules();
      if (prev === undefined) delete process.env.CHROME_BIN;
      else process.env.CHROME_BIN = prev;
    });

    it('dedupes concurrent launches into a single chromium.launch call', async () => {
      const browser = makeBrowser();
      let resolveLaunch: (b: any) => void = () => {};
      launchMock.mockImplementation(
        () => new Promise((res) => { resolveLaunch = res; })
      );

      const p1 = getBrowser();
      const p2 = getBrowser();
      const p3 = getBrowser();

      resolveLaunch(browser);
      const [a, b, c] = await Promise.all([p1, p2, p3]);

      expect(a).toBe(browser);
      expect(b).toBe(browser);
      expect(c).toBe(browser);
      expect(launchMock).toHaveBeenCalledTimes(1);
    });

    it('relaunches after Chromium disconnects', async () => {
      const first = makeBrowser();
      const second = makeBrowser();
      launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      const a = await getBrowser();
      expect(a).toBe(first);

      // Simulate upstream crash.
      first._emit('disconnected');

      const b = await getBrowser();
      expect(b).toBe(second);
      expect(launchMock).toHaveBeenCalledTimes(2);
    });

    it('wraps launch failure in an Internal AppError', async () => {
      launchMock.mockRejectedValue(new Error('binary missing'));

      await expect(getBrowser()).rejects.toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
      });
    });

    it('clears the in-flight promise on failure so the next call retries', async () => {
      launchMock.mockRejectedValueOnce(new Error('boom'));
      await expect(getBrowser()).rejects.toBeDefined();

      const browser = makeBrowser();
      launchMock.mockResolvedValueOnce(browser);
      const ok = await getBrowser();
      expect(ok).toBe(browser);
      expect(launchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('withContext', () => {
    it('exposes a pooled context to fn and returns its value', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      const result = await withContext(async (ctx) => {
        expect((ctx as any)._kind).toBe('context');
        return 'value';
      });

      expect(result).toBe('value');
      // The pool creates the backing context with the default viewport.
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 900, height: 600 } })
      );
    });

    it('re-throws the original error when fn throws', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      await expect(
        withContext(async () => {
          throw new Error('handler boom');
        })
      ).rejects.toThrow('handler boom');
    });
  });

  describe('withPage', () => {
    it('opens a pooled page+context, applies the default viewport, runs fn, and closes the page', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      let seenPage: any;
      const result = await withPage(async (page, ctx) => {
        seenPage = page;
        expect((page as any)._kind).toBe('page');
        expect((ctx as any)._kind).toBe('context');
        return 42;
      });

      expect(result).toBe(42);
      // Context is created once with the default viewport.
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 900, height: 600 } })
      );
      // Viewport is applied on the page (pool sets it per-acquire).
      expect(seenPage.setViewportSize).toHaveBeenCalledWith({ width: 900, height: 600 });
      // Page is closed after use; the context returns to the pool (not closed).
      expect(seenPage.close).toHaveBeenCalledTimes(1);
      const ctx = await browser.newContext.mock.results[0]!.value;
      expect(ctx.clearCookies).toHaveBeenCalledTimes(1);
      expect(ctx.close).not.toHaveBeenCalled();
    });

    it('applies a caller-supplied viewport via setViewportSize', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      let seenPage: any;
      await withPage(
        async (page) => {
          seenPage = page;
        },
        { viewport: { width: 1280, height: 720 } }
      );

      expect(seenPage.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 });
    });

    it('reuses a pooled context across sequential calls', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      await withPage(async () => {});
      await withPage(async () => {});

      // Same idle slot is reused → context created only once.
      expect(browser.newContext).toHaveBeenCalledTimes(1);
    });

    it('closes the page and re-throws when fn throws', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      let seenPage: any;
      await expect(
        withPage(async (page) => {
          seenPage = page;
          throw new Error('handler boom');
        })
      ).rejects.toThrow('handler boom');

      expect(seenPage.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('closes the browser and clears the singleton', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      await getBrowser();
      await shutdown();

      expect(browser.close).toHaveBeenCalledTimes(1);

      const second = makeBrowser();
      launchMock.mockResolvedValueOnce(second);
      const next = await getBrowser();
      expect(next).toBe(second);
    });

    it('is a no-op when no browser is launched', async () => {
      await expect(shutdown()).resolves.toBeUndefined();
      expect(launchMock).not.toHaveBeenCalled();
    });
  });
});
