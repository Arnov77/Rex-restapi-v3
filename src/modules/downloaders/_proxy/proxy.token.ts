/**
 * Signed proxy tokens — HMAC-SHA256 based.
 *
 * Each downloader service generates a token containing the source URL +
 * expiry. The proxy route verifies the signature before streaming. This
 * prevents the proxy from becoming an open relay.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../../../config/env.js';

export interface ProxyPayload {
  /** Source URL to stream from */
  url: string;
  /** Unix timestamp (seconds) when the token expires */
  exp: number;
  /** Optional filename hint for Content-Disposition */
  filename?: string;
  /** Optional content-type override */
  contentType?: string;
}

function getSecret(): string {
  return loadEnv().JWT_SECRET; // Reuse existing secret — no new env needed
}

function encodePayload(payload: ProxyPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(encoded: string): ProxyPayload {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

function sign(encoded: string): string {
  return createHmac('sha256', getSecret()).update(encoded).digest('base64url');
}

/**
 * Create a signed proxy token. Returns a compact string safe for query params.
 */
export function createProxyToken(payload: ProxyPayload): string {
  const encoded = encodePayload(payload);
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a proxy token. Returns null if invalid or expired.
 */
export function verifyProxyToken(token: string): ProxyPayload | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  // Timing-safe compare
  const expected = sign(encoded);
  if (sig.length !== expected.length) return null;
  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = decodePayload(encoded);
    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Helper: create a proxy URL for the given source URL.
 * TTL defaults to DOWNLOAD_PROXY_TTL_SEC env (default 3600 = 1 hour).
 */
export function proxyUrl(
  baseUrl: string,
  sourceUrl: string,
  opts?: { filename?: string; contentType?: string; ttlSec?: number },
): string {
  const env = loadEnv();
  const ttl = opts?.ttlSec ?? env.DOWNLOAD_PROXY_TTL_SEC;
  const token = createProxyToken({
    url: sourceUrl,
    exp: Math.floor(Date.now() / 1000) + ttl,
    filename: opts?.filename,
    contentType: opts?.contentType,
  });
  return `${baseUrl}/api/download/proxy?t=${token}`;
}
