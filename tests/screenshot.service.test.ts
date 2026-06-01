import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const browserMock = { withPage: vi.fn() };
const ssrfMock = { assertPublicUrl: vi.fn() };

vi.mock('../src/shared/browser/browserManager.js', () => ({
  withPage: (fn: any, opts: any) => browserMock.withPage(fn, opts),
}));

vi.mock('../src/shared/utils/ssrfGuard.js', () => ({
  assertPublicUrl: (...a: any[]) => ssrfMock.assertPublicUrl(...a),
}));

const { screenshotService } = await import('../src/modules/tools/screenshot/screenshot.service.js');
const { ScreenshotQuery } = await import('../src/modules/tools/screenshot/screenshot.schemas.js');

beforeEach(() => {
  browserMock.withPage.mockReset();
  ssrfMock.assertPublicUrl.mockReset().mockResolvedValue(new URL('https://example.com/'));
});
afterEach(() => vi.restoreAllMocks());

function makePage(buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])) {
  return {
    emulateMedia: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    screenshot: vi.fn(async () => buf),
  };
}

describe('screenshot.schemas', () => {
  it('applies defaults', () => {
    const p = ScreenshotQuery.parse({ url: 'https://example.com' });
    expect(p).toMatchObject({ width: 1280, height: 720, format: 'png', quality: 85, fullPage: false });
  });
  it.each([
    // The schema auto-prepends https:// to bare hosts, so "not-a-url" is now
    // accepted as a hostname. Empty / scheme-only inputs still fail validation.
    { url: '' },
    { url: 'https://x.com', width: 100 },
    { url: 'https://x.com', width: 9999 },
    { url: 'https://x.com', height: 100 },
    { url: 'https://x.com', format: 'gif' },
    { url: 'https://x.com', quality: 0 },
    { url: 'https://x.com', waitFor: 99999 },
  ])('rejects invalid input %j', (input) => {
    expect(ScreenshotQuery.safeParse(input).success).toBe(false);
  });
  it('coerces query-string strings to numbers/booleans', () => {
    const p = ScreenshotQuery.parse({ url: 'https://x.com', width: '800', fullPage: 'true' });
    expect(p.width).toBe(800);
    expect(p.fullPage).toBe(true);
  });
});

describe('screenshot.service.capture', () => {
  it('runs SSRF guard before touching the browser', async () => {
    ssrfMock.assertPublicUrl.mockRejectedValueOnce({ statusCode: 400, message: 'blocked' });
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'http://127.0.0.1' })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(browserMock.withPage).not.toHaveBeenCalled();
  });

  it('captures PNG with correct viewport and mime', async () => {
    const page = makePage();
    browserMock.withPage.mockImplementationOnce(async (fn: any, opts: any) => {
      expect(opts.viewport).toEqual({ width: 1280, height: 720 });
      return fn(page);
    });
    const out = await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com' }),
    );
    expect(out.mimeType).toBe('image/png');
    expect(out.format).toBe('png');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
    expect(page.emulateMedia).not.toHaveBeenCalled();
  });

  it('passes JPEG quality and fullPage flag', async () => {
    const page = makePage(Buffer.from([0xff, 0xd8]));
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    const out = await screenshotService.capture(
      ScreenshotQuery.parse({
        url: 'https://example.com',
        format: 'jpeg',
        quality: 70,
        fullPage: true,
      }),
    );
    expect(out.mimeType).toBe('image/jpeg');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', fullPage: true, quality: 70 });
  });

  it('emulates dark mode when requested', async () => {
    const page = makePage();
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com', darkMode: true }),
    );
    expect(page.emulateMedia).toHaveBeenCalledWith({ colorScheme: 'dark' });
  });

  it('falls back to domcontentloaded when networkidle times out', async () => {
    const page = makePage();
    const goto = vi
      .fn<(...a: any[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('networkidle timeout'))
      .mockResolvedValueOnce(undefined);
    page.goto = goto;
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' }));
    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto.mock.calls[1]![1]).toMatchObject({ waitUntil: 'domcontentloaded' });
  });

  it('honours waitFor', async () => {
    const page = makePage();
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com', waitFor: 500 }),
    );
    expect(page.waitForTimeout).toHaveBeenCalledWith(500);
  });

  it('throws Internal on empty buffer', async () => {
    const page = makePage(Buffer.alloc(0));
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
