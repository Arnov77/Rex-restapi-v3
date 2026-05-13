import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { loadEnv } from '../../config/env.js';
import { Internal } from '../errors.js';

/**
 * Shared singleton Chromium for all media/tools modules (screenshot, brat,
 * quote, …). Per-request isolation comes from `browser.newContext()`, which
 * is the Playwright equivalent of an incognito profile (no shared cookies,
 * storage, or cache).
 *
 * Why singleton: launching+closing Chromium per request previously cost
 * ~1–2s and several hundred MB of RAM. Reusing one browser eliminates that
 * tax while keeping requests isolated.
 */

const DEFAULT_VIEWPORT = { width: 900, height: 600 } as const;

let instance: Browser | null = null;
let launching: Promise<Browser> | null = null;

function buildLaunchOptions(): Parameters<typeof chromium.launch>[0] {
  const env = loadEnv();
  const opts: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'],
  };
  if (env.CHROME_BIN) opts.executablePath = env.CHROME_BIN;
  return opts;
}

async function launch(): Promise<Browser> {
  try {
    const browser = await chromium.launch(buildLaunchOptions());
    // Auto-recover from upstream crashes — drop the stale handle so the next
    // caller relaunches transparently instead of getting a dead browser.
    browser.on('disconnected', () => {
      if (instance === browser) instance = null;
    });
    return browser;
  } catch (err) {
    throw Internal('Failed to launch Chromium', { message: (err as Error).message });
  }
}

export async function getBrowser(): Promise<Browser> {
  if (instance) return instance;
  if (!launching) {
    launching = launch()
      .then((b) => {
        instance = b;
        return b;
      })
      .finally(() => {
        launching = null;
      });
  }
  return launching;
}

export async function withContext<T>(
  fn: (context: BrowserContext) => Promise<T>,
  contextOptions: BrowserContextOptions = {}
): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { ...DEFAULT_VIEWPORT },
    ...contextOptions,
  });
  try {
    return await fn(context);
  } finally {
    await context.close().catch(() => {
      /* swallow — context teardown failures must not mask the real error */
    });
  }
}

export async function withPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  contextOptions: BrowserContextOptions = {}
): Promise<T> {
  return withContext(async (context) => {
    const page = await context.newPage();
    return fn(page, context);
  }, contextOptions);
}

export async function shutdown(): Promise<void> {
  const current = instance;
  instance = null;
  if (!current) return;
  await current.close().catch(() => {
    /* ignore — best-effort shutdown */
  });
}

/** Test-only: reset cached singleton. Not exported from a public barrel. */
export function __resetForTests(): void {
  instance = null;
  launching = null;
}

export const browserManager = { getBrowser, withContext, withPage, shutdown };
export default browserManager;
