// gifenc has no `exports` map and ships CJS as `main`; named ESM imports
// from the bare specifier fail under Node 20. Point at the ESM build directly.
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';
import { PNG } from 'pngjs';
import { withPage } from '../../shared/browser/browserManager.js';
import { assertPublicUrl } from '../../shared/utils/ssrfGuard.js';
import { Internal } from '../../shared/errors.js';
import { renderBratHtml } from './brat.template.js';
import type { BratQuery } from './brat.schemas.js';

export interface BratResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif';
  format: 'png' | 'jpeg' | 'gif';
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
} as const;

/**
 * Render one brat caption frame at a fixed blur and return raw PNG bytes.
 * Caller controls viewport via `withPage` so we can vary blur per frame
 * without re-launching Chromium.
 */
async function snapFrame(page: Page, html: string): Promise<Buffer> {
  // setContent is local — no network fetch happens for the HTML itself.
  // The only outbound request would be the optional bgImage, which the
  // service has already SSRF-guarded.
  await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
  // Give the auto-shrink script a moment to settle the layout.
  await page.waitForFunction(
    "document.documentElement.dataset['ready'] === '1'",
    undefined,
    { timeout: 2_000 },
  ).catch(() => {
    /* fall through — render anyway, worst case the text is slightly off-fit */
  });
  const buf = await page.screenshot({ type: 'png', omitBackground: false });
  if (!buf || buf.length === 0) throw Internal('Brat frame produced empty buffer');
  return buf;
}

/**
 * Decode a PNG screenshot into raw RGBA pixels using the browser canvas
 * we already have running. This avoids pulling a node-side PNG decoder
 * (sharp/upng) just for GIF encoding.
 */
async function pngToRgba(
  page: Page,
  png: Buffer,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const b64 = png.toString('base64');
  // Run inside the page — DOM globals exist there, not in node.
  const evalFn = (async ({ b64, w, h }: { b64: string; w: number; h: number }) => {
    const D = (globalThis as any).document;
    const ImageCtor = (globalThis as any).Image;
    const img = new ImageCtor();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = D.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data) as number[];
  }) as unknown as (a: { b64: string; w: number; h: number }) => Promise<number[]>;
  const data = await page.evaluate(evalFn, { b64, w: width, h: height });
  return new Uint8ClampedArray(data);
}

export async function generate(opts: BratQuery): Promise<BratResult> {
  // SSRF guard runs BEFORE the browser is touched. Same rule as screenshot:
  // a blocked URL must never reach Playwright.
  if (opts.bgImage) await assertPublicUrl(opts.bgImage);

  if (opts.format === 'gif') return generateGif(opts);
  return generateStill(opts);
}

async function generateStill(opts: BratQuery): Promise<BratResult> {
  const html = renderBratHtml(opts);
  const buffer = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, {
          timeout: 2_000,
        })
        .catch(() => {});
      const fmt = opts.format as 'png' | 'jpeg';
      const shotOpts: Parameters<typeof page.screenshot>[0] = { type: fmt };
      if (fmt === 'jpeg') shotOpts.quality = opts.quality;
      return page.screenshot(shotOpts);
    },
    { viewport: { width: opts.width, height: opts.height } },
  );

  if (!buffer || buffer.length === 0) throw Internal('Brat produced an empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

async function generateGif(opts: BratQuery): Promise<BratResult> {
  // "Bratvid" — progressive word reveal. Frame N shows the first N words of
  // the caption. We render the FULL text first so the shrink-to-fit loop
  // settles on the final font-size, then per frame replace innerText with a
  // cumulative slice. The last frame holds longer so the full caption is
  // readable before the loop wraps.
  const words = opts.text.split(/\s+/).filter(Boolean);
  const frameCount = Math.max(1, Math.min(words.length, 30));
  const HOLD_MS = 1200;

  const buffer = await withPage(
    async (page) => {
      const html = renderBratHtml(opts);
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, {
          timeout: 2_000,
        })
        .catch(() => {});

      const enc = GIFEncoder();
      const setText = (s: string) =>
        page.evaluate((v: string) => {
          const el = (globalThis as any).document.getElementById('t');
          if (el) el.textContent = v;
        }, s);

      for (let i = 0; i < frameCount; i++) {
        const partial = words.slice(0, i + 1).join(' ');
        await setText(partial);
        const png = await page.screenshot({ type: 'png', omitBackground: false });
        if (!png || png.length === 0) throw Internal('Brat frame produced empty buffer');
        const rgba = await pngToRgba(page, png, opts.width, opts.height);
        const palette = quantize(rgba, 256);
        const indexed = applyPalette(rgba, palette);
        const isLast = i === frameCount - 1;
        enc.writeFrame(indexed, opts.width, opts.height, {
          palette,
          delay: isLast ? HOLD_MS : opts.delay,
        });
      }
      enc.finish();
      return Buffer.from(enc.bytes());
    },
    { viewport: { width: opts.width, height: opts.height } },
  );

  if (!buffer || buffer.length === 0) throw Internal('Brat GIF produced an empty buffer');
  return { buffer, mimeType: MIME.gif, format: 'gif' };
}

export const bratService = { generate };
