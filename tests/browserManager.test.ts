import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock playwright-core ─────────────────────────────────────────────────

type Listener = () => void;

function makePage() {
  return { _kind: 'page' };
}

function makeContext() {
  const ctx: any = {
    _kind: 'context',
    newPage: vi.fn(async () => makePage()),
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

const launchMock = vi.fn();

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
    it('creates a context with the default viewport, runs fn, and closes it', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      const result = await withContext(async (ctx) => {
        expect((ctx as any)._kind).toBe('context');
        return 'value';
      });

      expect(result).toBe('value');
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 900, height: 600 } })
      );
      const ctx = await browser.newContext.mock.results[0]!.value;
      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it('merges caller-supplied context options over defaults', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      await withContext(async () => null, {
        viewport: { width: 1280, height: 720 },
        acceptDownloads: true,
      });

      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport: { width: 1280, height: 720 },
          acceptDownloads: true,
        })
      );
    });

    it('closes the context even when fn throws, and re-throws the original error', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      let captured: any;
      browser.newContext.mockImplementationOnce(async () => {
        captured = makeContext();
        return captured;
      });

      await expect(
        withContext(async () => {
          throw new Error('handler boom');
        })
      ).rejects.toThrow('handler boom');

      expect(captured.close).toHaveBeenCalledTimes(1);
    });

    it('does not mask handler errors when context.close fails', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      browser.newContext.mockImplementationOnce(async () => {
        const ctx = makeContext();
        ctx.close = vi.fn(async () => {
          throw new Error('close failed');
        });
        return ctx;
      });

      await expect(
        withContext(async () => {
          throw new Error('handler boom');
        })
      ).rejects.toThrow('handler boom');
    });
  });

  describe('withPage', () => {
    it('opens a page inside a fresh context and exposes both to fn', async () => {
      const browser = makeBrowser();
      launchMock.mockResolvedValue(browser);

      const result = await withPage(async (page, ctx) => {
        expect((page as any)._kind).toBe('page');
        expect((ctx as any)._kind).toBe('context');
        return 42;
      });

      expect(result).toBe(42);
      const ctx = await browser.newContext.mock.results[0]!.value;
      expect(ctx.newPage).toHaveBeenCalledTimes(1);
      expect(ctx.close).toHaveBeenCalledTimes(1);
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
