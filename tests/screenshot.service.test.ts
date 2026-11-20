import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const ssrfMock = { assertPublicUrl: vi.fn() };

vi.mock('../src/shared/utils/ssrfGuard.js', () => ({
  assertPublicUrl: (...a: any[]) => ssrfMock.assertPublicUrl(...a),
}));

const { screenshotService } = await import('../src/modules/tools/screenshot/screenshot.service.js');
const { ScreenshotQuery } = await import('../src/modules/tools/screenshot/screenshot.schemas.js');

// ── fetch mock helpers ───────────────────────────────────────────────────

const PNG_BUF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const ML_OK = {
  status: 'success',
  data: { screenshot: { url: 'https://iad.microlink.io/x.png' } },
};

interface MockFetchOpts {
  mlBody?: unknown;
  mlOk?: boolean;
  mlStatus?: number;
  imgBuf?: Buffer;
  imgOk?: boolean;
}

/** fetch mock: JSON Microlink untuk api.microlink.io, bytes gambar untuk URL lain. */
function mockFetch({
  mlBody = ML_OK,
  mlOk = true,
  mlStatus = mlOk ? 200 : 429,
  imgBuf = PNG_BUF,
  imgOk = true,
}: MockFetchOpts = {}) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('https://api.microlink.io/')) {
      return { ok: mlOk, status: mlStatus, json: async () => mlBody };
    }
    return { ok: imgOk, status: imgOk ? 200 : 500, arrayBuffer: async () => toArrayBuffer(imgBuf) };
  });
}

function microlinkParams(fetchMock: ReturnType<typeof mockFetch>): URLSearchParams {
  const url = String(fetchMock.mock.calls[0]?.[0]);
  expect(url.startsWith('https://api.microlink.io/?')).toBe(true);
  return new URL(url).searchParams;
}

beforeEach(() => {
  ssrfMock.assertPublicUrl.mockReset().mockResolvedValue(new URL('https://example.com/'));
  vi.stubGlobal('fetch', mockFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  it('runs SSRF guard before touching Microlink', async () => {
    ssrfMock.assertPublicUrl.mockRejectedValueOnce({ statusCode: 400, message: 'blocked' });
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch must not be called');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'http://127.0.0.1' })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('captures PNG with correct Microlink params', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const out = await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const params = microlinkParams(fetchMock);
    expect(params.get('url')).toBe('https://example.com');
    expect(params.get('screenshot')).toBe('true');
    expect(params.get('screenshot.type')).toBe('png');
    expect(params.get('viewport.width')).toBe('1280');
    expect(params.get('viewport.height')).toBe('720');
    expect(params.get('viewport.deviceScaleFactor')).toBe('1');
    expect(params.get('meta')).toBe('false');
    expect(params.has('screenshot.fullPage')).toBe(false);
    expect(params.has('colorScheme')).toBe(false);
    expect(params.has('waitForTimeout')).toBe(false);
    expect(params.has('apiKey')).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://iad.microlink.io/x.png');
    expect(out.mimeType).toBe('image/png');
    expect(out.format).toBe('png');
    expect(out.buffer.equals(PNG_BUF)).toBe(true);
  });

  it('passes JPEG quality and fullPage flag', async () => {
    const fetchMock = mockFetch({ imgBuf: JPEG_BUF });
    vi.stubGlobal('fetch', fetchMock);
    const out = await screenshotService.capture(
      ScreenshotQuery.parse({
        url: 'https://example.com',
        format: 'jpeg',
        quality: 70,
        fullPage: true,
      }),
    );
    const params = microlinkParams(fetchMock);
    expect(params.get('screenshot.type')).toBe('jpeg');
    expect(params.get('screenshot.quality')).toBe('70');
    expect(params.get('screenshot.fullPage')).toBe('true');
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.buffer.equals(JPEG_BUF)).toBe(true);
  });

  it('passes dark mode as colorScheme', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com', darkMode: true }),
    );
    expect(microlinkParams(fetchMock).get('colorScheme')).toBe('dark');
  });

  it('passes waitFor as waitForTimeout', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    await screenshotService.capture(
      ScreenshotQuery.parse({ url: 'https://example.com', waitFor: 500 }),
    );
    expect(microlinkParams(fetchMock).get('waitForTimeout')).toBe('500');
  });

  it('throws 502 when Microlink reports failure', async () => {
    const fetchMock = mockFetch({ mlBody: { status: 'fail', message: 'oops' } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 502, code: 'SCREENSHOT_UPSTREAM_FAILED' });
    // Image fetch must not happen after a failed Microlink response.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws 502 on Microlink HTTP error', async () => {
    const fetchMock = mockFetch({
      mlBody: { status: 'fail', message: 'rate limited' },
      mlOk: false,
      mlStatus: 429,
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws 502 when screenshot URL is missing', async () => {
    const fetchMock = mockFetch({ mlBody: { status: 'success', data: {} } });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws 502 when image download fails', async () => {
    const fetchMock = mockFetch({ imgOk: false });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws Internal on empty buffer', async () => {
    const fetchMock = mockFetch({ imgBuf: Buffer.alloc(0) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      screenshotService.capture(ScreenshotQuery.parse({ url: 'https://example.com' })),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
