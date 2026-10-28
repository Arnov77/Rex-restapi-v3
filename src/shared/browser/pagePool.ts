// src/shared/browser/pagePool.ts

/**
 * PagePool Stub
 * Dinonaktifkan bersamaan dengan browserManager.
 */

export type PagePoolOptions = any;
export type PagePoolSlot = any;

export class PagePool {
  stats = {
    size: 0,
    created: 0,
    busy: 0,
    idle: 0,
    queued: 0,
    acquireCount: 0,
    releaseCount: 0,
    timeoutCount: 0,
  };

  constructor(_opts?: any) {}
  attach(_browser: any): void {}
  async acquire(_opts?: any): Promise<any> {
    throw new Error('Browser/PagePool dinonaktifkan.');
  }
  async release(_slot: any): Promise<void> {}
  async drain(): Promise<void> {}
}

export default PagePool;