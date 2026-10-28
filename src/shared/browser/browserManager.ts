// src/shared/browser/browserManager.ts

/**
 * Browser Manager Stub
 * Playwright/Chromium dinonaktifkan untuk menghemat resource dan kompatibilitas hosting.
 */

export type Browser = any;
export type BrowserContext = any;
export type BrowserContextOptions = any;

// Definisikan screenshot agar menerima `any` sehingga 'shotOpts' tidak menjadi 'unknown'
export type Page = {
  screenshot: (options: any) => Promise<any>;
  [key: string]: any;
};

export interface WithPageOptions {
  signal?: AbortSignal;
  viewport?: { width: number; height: number };
  [key: string]: any;
}

export async function getBrowser(): Promise<Browser> {
  throw new Error('Fitur browser/Chromium dinonaktifkan.');
}

export async function withPage<T>(
  _fn: (page: Page, context: BrowserContext) => Promise<T>,
  _opts: WithPageOptions = {},
): Promise<T> {
  throw new Error('Fitur browser/Chromium dinonaktifkan.');
}

export async function withContext<T>(
  _fn: (context: BrowserContext) => Promise<T>,
  _contextOptions: BrowserContextOptions = {},
): Promise<T> {
  throw new Error('Fitur browser/Chromium dinonaktifkan.');
}

export async function shutdown(): Promise<void> {
  // No-op agar proses graceful shutdown / app.close() selesai dengan aman
}

export function poolStats() {
  return {
    size: 0,
    created: 0,
    busy: 0,
    idle: 0,
    queued: 0,
    acquireCount: 0,
    releaseCount: 0,
    timeoutCount: 0,
  };
}

export function __resetForTests(): void {}

export const browserManager = { getBrowser, withContext, withPage, shutdown, poolStats };
export default browserManager;