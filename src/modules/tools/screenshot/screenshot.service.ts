import { loadEnv } from '../../../config/env.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { AppError, Internal } from '@shared/errors.js';
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

// Microlink (https://microlink.io) menggantikan Chromium lokal — Chromium
// tidak jalan di panel (playwright-core di-uninstall). Pola yang sama
// dengan bot (.screenshotweb): tanpa API key gratis, ada batas harian;
// URL yang sama ter-cache 24 jam dan tidak memakan kuota.
const MICROLINK_API_URL = 'https://api.microlink.io/';
const UPSTREAM_TIMEOUT_MS = 60_000;

interface MicrolinkResponse {
  status?: string;
  message?: string;
  data?: {
    screenshot?: {
      url?: string;
    };
  };
}

function upstreamFailed(message?: string): AppError {
  return new AppError(
    502,
    'SCREENSHOT_UPSTREAM_FAILED',
    message ? `Screenshot provider failed: ${message}` : 'Screenshot provider failed',
  );
}

/**
 * Capture a screenshot via the Microlink API.
 * The whole query surface is preserved: viewport, fullPage, format +
 * quality, waitFor and darkMode all have a Microlink equivalent
 * (viewport.*, screenshot.fullPage, screenshot.type/quality,
 * waitForTimeout, colorScheme).
 */
export async function capture(opts: ScreenshotQuery, { signal }: CaptureOptions = {}): Promise<ScreenshotResult> {
  // SSRF guard runs BEFORE the upstream is touched. A blocked URL must
  // never reach Microlink — it would otherwise be a confused deputy
  // hitting internal/cloud-metadata endpoints on our behalf.
  await assertPublicUrl(opts.url);

  const env = loadEnv();
  const params = new URLSearchParams({
    url: opts.url,
    screenshot: 'true',
    'screenshot.type': opts.format,
    'viewport.width': String(opts.width),
    'viewport.height': String(opts.height),
    // Default device preset is retina (2x); force 1x so the output is
    // exactly the requested viewport size, like the old Chromium capture.
    'viewport.deviceScaleFactor': '1',
    // We only need the image — skip metadata detection.
    meta: 'false',
  });
  if (opts.format === 'jpeg') params.set('screenshot.quality', String(opts.quality));
  if (opts.fullPage) params.set('screenshot.fullPage', 'true');
  if (opts.darkMode) params.set('colorScheme', 'dark');
  if (opts.waitFor > 0) params.set('waitForTimeout', String(opts.waitFor));
  if (env.MICROLINK_API_KEY) params.set('apiKey', env.MICROLINK_API_KEY);

  // Hard timeout di atas signal dari client: Microlink free mentok 30 dtk
  // di sisi server, jadi 60 dtk cukup longgar tanpa menggantung request.
  const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(`${MICROLINK_API_URL}?${params}`, { signal: combined });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' && signal?.aborted) throw e;
    throw upstreamFailed((e as Error)?.message);
  }

  let body: MicrolinkResponse | null = null;
  try {
    body = (await res.json()) as MicrolinkResponse;
  } catch {
    // Non-JSON error body — fall through to the status check below.
  }

  if (!res.ok || body?.status !== 'success') {
    throw upstreamFailed(body?.message ?? `Microlink returned HTTP ${res.status}`);
  }

  const shotUrl = body?.data?.screenshot?.url;
  if (!shotUrl) throw upstreamFailed('Microlink did not return a screenshot');

  let imgRes: Response;
  try {
    imgRes = await fetch(shotUrl, { signal: combined });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' && signal?.aborted) throw e;
    throw upstreamFailed((e as Error)?.message);
  }
  if (!imgRes.ok) throw upstreamFailed(`Screenshot download returned HTTP ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  if (!buffer || buffer.length === 0) {
    throw Internal('Screenshot produced an empty buffer');
  }
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

export const screenshotService = { capture };
