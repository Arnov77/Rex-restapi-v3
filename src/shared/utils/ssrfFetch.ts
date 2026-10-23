import { assertPublicUrl } from './ssrfGuard.js';
import { AppError } from '@shared/errors.js';

/**
 * SSRF-safe fetch for user-supplied URLs.
 *
 * Follows the same pattern as the download proxy (`streamProxy.ts`):
 * every hop — the initial URL AND each redirect Location — is validated
 * with `assertPublicUrl` (DNS resolution, rejects private/loopback/
 * link-local/cloud-metadata addresses) before any connection is opened.
 * Redirects are followed manually (`redirect: 'manual'`) so a public host
 * that 30x-redirects to an internal address cannot bypass the guard.
 *
 * Residual risk: `assertPublicUrl` is a TOCTOU check — a DNS-rebinding
 * attacker can return a public IP at lookup time and a private IP when
 * fetch resolves. Treat as a strong baseline, not absolute defence.
 */

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SsrfFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Caller signal (merged with the internal timeout). */
  signal?: AbortSignal;
  /** Per-request timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * Fetch `rawUrl` with manual redirect handling. Returns the final response
 * with its body NOT consumed — the caller reads or discards it.
 */
export async function ssrfSafeFetch(rawUrl: string, opts: SsrfFetchOptions = {}): Promise<Response> {
  const {
    method = 'GET',
    headers,
    signal,
    timeoutMs = 15_000,
    maxRedirects = MAX_REDIRECTS,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // Throws AppError(400) when the target resolves to a blocked address.
      const url = await assertPublicUrl(current);
      const res = await fetch(url, {
        method,
        headers,
        signal: mergedSignal,
        redirect: 'manual',
      });

      if (!REDIRECT_STATUSES.has(res.status)) return res;

      const location = res.headers.get('location');
      // Drain the redirect body so the socket can be reused, then re-validate.
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore drain errors */
      }
      if (!location) return res; // redirect without target — treat as final

      current = new URL(location, url).toString();
    }
    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body into a Buffer, enforcing a hard byte cap while
 * streaming (the `content-length` header is advisory/spoofable).
 * Throws AppError(413) when the cap is exceeded.
 */
export async function readBodyCapped(res: Response, maxBytes: number, code = 'BODY_TOO_LARGE'): Promise<Buffer> {
  const tooLarge = () =>
    new AppError(
      413,
      code,
      `Upstream body exceeded ${Math.round(maxBytes / 1024 / 1024)}MB cap`,
      undefined,
      `File terlalu besar (maks ${Math.round(maxBytes / 1024 / 1024)}MB).`,
    );

  const cl = Number(res.headers.get('content-length') || 0);
  if (cl > maxBytes) throw tooLarge();
  if (!res.body) throw tooLarge();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
