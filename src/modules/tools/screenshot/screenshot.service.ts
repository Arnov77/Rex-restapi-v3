import { withPage } from '@shared/browser/browserManager.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { Internal } from '@shared/errors.js';
import type { ScreenshotQuery } from './screenshot.schemas.js';

export interface ScreenshotResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  format: 'png' | 'jpeg';
}

export interface CaptureOptions {
  /** AbortSignal from the HTTP request — cancels the render early on client disconnect. */
  signal?: AbortSignal;
}

const MIME: Record<'png' | 'jpeg', 'image/png' | 'image/jpeg'> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/**
 * Capture a single screenshot through the shared Chromium page pool.
 * Each call gets a pooled context (cookies cleared between uses) so
 * state never leaks between requests.
 */
export async function capture(opts: ScreenshotQuery, { signal }: CaptureOptions = {}): Promise<ScreenshotResult> {
  // SSRF guard runs BEFORE the browser is touched. A blocked URL must never
  // reach Playwright — the headless Chromium would otherwise be a confused
  // deputy hitting internal/cloud-metadata endpoints.
  await assertPublicUrl(opts.url);

  const buffer = await withPage(
    async (page) => {
      if (opts.darkMode) {
        await page.emulateMedia({ colorScheme: 'dark' });
      }
      try {
        await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch {
        // networkidle is fragile on chatty pages — fall back to a faster
        // signal so we still produce *something* instead of 500-ing.
        await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      }
      if (opts.waitFor > 0) await page.waitForTimeout(opts.waitFor);

      const shotOpts: Parameters<typeof page.screenshot>[0] = {
        type: opts.format,
        fullPage: opts.fullPage,
      };
      if (opts.format === 'jpeg') shotOpts.quality = opts.quality;
      return page.screenshot(shotOpts);
    },
    { viewport: { width: opts.width, height: opts.height }, signal },
  );

  if (!buffer || buffer.length === 0) {
    throw Internal('Screenshot produced an empty buffer');
  }
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

export const screenshotService = { capture };
