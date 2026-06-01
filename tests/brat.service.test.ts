import './setupEnv.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browserMock = { withPage: vi.fn() };
const ssrfMock = { assertPublicUrl: vi.fn() };
const gifMock = {
  GIFEncoder: vi.fn(),
  quantize: vi.fn(),
  applyPalette: vi.fn(),
};

vi.mock('../src/shared/browser/browserManager.js', () => ({
  withPage: (fn: any, opts: any) => browserMock.withPage(fn, opts),
}));
vi.mock('../src/shared/utils/ssrfGuard.js', () => ({
  assertPublicUrl: (...a: any[]) => ssrfMock.assertPublicUrl(...a),
}));
vi.mock('gifenc', () => ({
  default: {
    GIFEncoder: (...a: any[]) => gifMock.GIFEncoder(...a),
    quantize: (...a: any[]) => gifMock.quantize(...a),
    applyPalette: (...a: any[]) => gifMock.applyPalette(...a),
  },
}));
// pngjs is used in the service to decode screenshot PNGs to raw RGBA. Tests
// pass synthetic non-PNG buffers, so stub the decoder to return empty pixels.
vi.mock('pngjs', () => ({
  PNG: { sync: { read: () => ({ data: Buffer.alloc(4), width: 1, height: 1 }) } },
}));

const { bratService } = await import('../src/modules/makers/brat/brat.service.js');
const { BratQuery } = await import('../src/modules/makers/brat/brat.schemas.js');

beforeEach(() => {
  browserMock.withPage.mockReset();
  ssrfMock.assertPublicUrl.mockReset().mockResolvedValue(new URL('https://cdn.example.com/x.png'));
  gifMock.GIFEncoder.mockReset();
  gifMock.quantize.mockReset().mockReturnValue([[0, 0, 0]]);
  gifMock.applyPalette.mockReset().mockReturnValue(new Uint8Array([0]));
});
afterEach(() => vi.restoreAllMocks());

function makePage(buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])) {
  return {
    setContent: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    screenshot: vi.fn(async () => buf),
    evaluate: vi.fn(async () => Array.from({ length: 4 }, () => 0)),
  };
}

describe('brat.schemas', () => {
  it('applies defaults', () => {
    const p = BratQuery.parse({ text: 'hello' });
    expect(p).toMatchObject({
      width: 512,
      height: 512,
      format: 'png',
      quality: 90,
      blur: 3.5,
      background: '#FFFFFF',
      color: '#000000',
      frames: 8,
      delay: 400,
    });
  });
  it.each([
    {},
    { text: '' },
    { text: 'a'.repeat(201) },
    { text: 'x', width: 100 },
    { text: 'x', height: 9999 },
    { text: 'x', format: 'avif' },
    { text: 'x', background: 'red' },
    { text: 'x', color: '#fff' },
    { text: 'x', blur: -1 },
    { text: 'x', frames: 1 },
    { text: 'x', frames: 31 },
    { text: 'x', delay: 10 },
    { text: 'x', delay: 9999 },
    { text: 'x', bgImage: 'not-a-url' },
  ])('rejects invalid input %j', (input) => {
    expect(BratQuery.safeParse(input).success).toBe(false);
  });
  it('coerces numeric/boolean strings from query', () => {
    const p = BratQuery.parse({ text: 'hi', width: '512', height: '512', frames: '8' });
    expect(p).toMatchObject({ width: 512, height: 512, frames: 8 });
  });
  it('trims whitespace from text', () => {
    expect(BratQuery.parse({ text: '   hi   ' }).text).toBe('hi');
  });
});

describe('brat.service.generate (still)', () => {
  it('skips SSRF guard when no bgImage provided', async () => {
    const page = makePage();
    browserMock.withPage.mockImplementationOnce(async (fn: any, opts: any) => {
      expect(opts.viewport).toEqual({ width: 512, height: 512 });
      return fn(page);
    });
    const out = await bratService.generate(BratQuery.parse({ text: 'brat' }));
    expect(ssrfMock.assertPublicUrl).not.toHaveBeenCalled();
    expect(out.format).toBe('png');
    expect(out.mimeType).toBe('image/png');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'png' });
  });

  it('runs SSRF guard before browser when bgImage provided', async () => {
    ssrfMock.assertPublicUrl.mockRejectedValueOnce({ statusCode: 400, message: 'blocked' });
    await expect(
      bratService.generate(
        BratQuery.parse({ text: 'x', bgImage: 'http://127.0.0.1/evil.png' }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(browserMock.withPage).not.toHaveBeenCalled();
  });

  it('renders JPEG with quality', async () => {
    const page = makePage(Buffer.from([0xff, 0xd8]));
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    const out = await bratService.generate(
      BratQuery.parse({ text: 'x', format: 'jpeg', quality: 60 }),
    );
    expect(out.mimeType).toBe('image/jpeg');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 60 });
  });

  it('throws Internal on empty PNG buffer', async () => {
    const page = makePage(Buffer.alloc(0));
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await expect(
      bratService.generate(BratQuery.parse({ text: 'x' })),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('escapes HTML in text (no raw injection)', async () => {
    const page = makePage();
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await bratService.generate(BratQuery.parse({ text: '<script>alert(1)</script>' }));
    const html = (page.setContent as any).mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('brat.service.generate (gif)', () => {
  it('encodes the requested number of frames', async () => {
    const page = makePage();
    const enc = {
      writeFrame: vi.fn(),
      finish: vi.fn(),
      bytes: vi.fn(() => new Uint8Array([0x47, 0x49, 0x46])),
    };
    gifMock.GIFEncoder.mockReturnValueOnce(enc);
    browserMock.withPage.mockImplementationOnce(async (fn: any, opts: any) => {
      expect(opts.viewport).toEqual({ width: 512, height: 512 });
      return fn(page);
    });
    const out = await bratService.generate(
      BratQuery.parse({ text: 'one two three four', format: 'gif', width: 512, height: 512, frames: 4, delay: 100 }),
    );
    expect(out.format).toBe('gif');
    expect(out.mimeType).toBe('image/gif');
    expect(enc.writeFrame).toHaveBeenCalledTimes(4);
    expect(enc.finish).toHaveBeenCalledOnce();
    // delay forwarded
    const frameOpts = enc.writeFrame.mock.calls[0]![3];
    expect(frameOpts).toMatchObject({ delay: 100 });
  });

  it('throws Internal when GIF buffer is empty', async () => {
    const page = makePage();
    const enc = {
      writeFrame: vi.fn(),
      finish: vi.fn(),
      bytes: vi.fn(() => new Uint8Array()),
    };
    gifMock.GIFEncoder.mockReturnValueOnce(enc);
    browserMock.withPage.mockImplementationOnce(async (fn: any) => fn(page));
    await expect(
      bratService.generate(BratQuery.parse({ text: 'hello world', format: 'gif', frames: 2 })),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
