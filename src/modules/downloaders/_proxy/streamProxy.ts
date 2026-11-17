/**
 * SSRF-safe upstream streaming for the signed-URL proxy routes.
 *
 * Shared by `/api/download/proxy` and `/p/:id`. Centralises the streaming
 * logic so the SSRF defences live in exactly one place.
 *
 * Hardening over the previous inline implementation:
 *  1. Every hop (the initial URL AND each redirect Location) is validated
 *     with `assertPublicUrl`, which resolves DNS and rejects private,
 *     loopback, link-local and cloud-metadata addresses. Redirects are
 *     followed manually (`redirect: 'manual'`) so a public host that
 *     30x-redirects to an internal address can no longer bypass the guard.
 *  2. The byte cap is enforced while streaming (counting real bytes), not
 *     only from the spoofable `content-length` header.
 *  3. The `Content-Disposition` filename is sanitised to prevent header
 *     injection / smuggling.
 *
 * Residual risk: `assertPublicUrl` is a TOCTOU check, so a determined
 * DNS-rebinding attacker controlling a public hostname could still race the
 * resolver. It remains a strong baseline, not absolute defence.
 *
 * Proxied fetches (signed tokens carrying `proxyIndex`, from the YouTube
 * proxy resolver) stream in bounded 1 MB chunks instead of one open-ended
 * fetch: googlevideo 403s open-ended (`bytes=0-`), full-bounded, and
 * Range-less requests from datacenter proxy IPs, while bounded ranges up
 * to 1 MB return 206 (proven on the panel 2026-11-17). Chunking is also
 * what "stream, don't download" means here: bytes flow to the client as
 * each chunk lands, like a player, instead of one bulk pull.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable, Transform } from 'node:stream';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { loadEnv } from '@/config/env.js';
import type { ProxyPayload } from './proxy.token.js';
import { getYoutubeProxyDispatcher } from '../youtube/youtubeProxy.js';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Largest bounded Range googlevideo accepts via proxy (proven 2026-11-17). */
const PROXY_CHUNK_BYTES = 1024 * 1024;
const CHUNK_TIMEOUT_MS = 30_000;
const CHUNK_ATTEMPTS = 3;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Build CDN-specific request headers (Referer/Range) for a given target. */
/** Build CDN-specific request headers (Referer/Range) for a given target. */
function buildHeaders(target: URL): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };
  const h = target.hostname;
  const isTiktokCdn = /tiktok|musical\.ly|byteoversea|ibytedtos|bytecdn|byte-?d/i.test(h);

  if (h.includes('tikwm.com')) {
    headers.Referer = 'https://www.tikwm.com/';
  } else if (isTiktokCdn) {
    headers.Referer = 'https://www.tiktok.com/';
    headers.Range = 'bytes=0-';
  } else if (h.includes('twimg.com') || h.includes('twitter') || h.includes('x.com')) {
    headers.Referer = 'https://x.com/';
  } else if (h.includes('googlevideo.com') || h.includes('youtube.com')) {
    // Penanganan khusus CDN YouTube:
    headers.Referer = 'https://www.youtube.com/';
    headers.Range = 'bytes=0-';
  } else if (h.includes('ytultra.com')) {
    headers.Referer = 'https://www.ytultra.com/';
    headers.Origin = 'https://www.ytultra.com';
  } else {
    headers.Referer = `${target.origin}/`;
  }

  return headers;
}

/** Hosts the proxy may stream from even if they resolve to private IPs —
 *  e.g. a self-hosted cobalt instance whose tunnels point at 127.0.0.1. */
function trustedInternalHosts(): string[] {
  const env = loadEnv();
  const hosts: string[] = [];
  try { hosts.push(new URL(env.COBALT_API_URL).hostname); } catch { /* ignore */ }
  for (const h of env.DOWNLOAD_PROXY_ALLOW_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)) {
    hosts.push(h);
  }
  return hosts;
}

/**
 * Fetch `rawUrl` with manual redirect handling. The initial URL and every
 * redirect target are validated with `assertPublicUrl` before a connection
 * is opened, closing the redirect-based SSRF bypass. When `proxyIndex` is
 * set (signed token from the YouTube proxy resolver), the request goes
 * through that proxy instead of direct — googlevideo 403s the signed URL
 * from this server's IP. The SSRF validation still runs: it checks the
 * URL itself, not the transport. `range`, when given, overrides the
 * Range header built for the target (chunked proxied fetches).
 */
async function ssrfSafeFetch(
  rawUrl: string,
  signal: AbortSignal,
  proxyIndex?: number,
  range?: string,
): Promise<Response> {
  const allowHosts = trustedInternalHosts();
  const dispatcher =
    proxyIndex !== undefined ? getYoutubeProxyDispatcher(proxyIndex) : undefined;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Throws AppError(400) when the target resolves to a blocked address.
    const url = await assertPublicUrl(current, { allowHosts });
    const headers = buildHeaders(url);
    if (range !== undefined) headers.Range = range;
    const res = await fetch(
      url,
      {
        signal,
        headers,
        redirect: 'manual',
        ...(dispatcher ? { dispatcher } : {}),
      } as any,
    );

    if (!REDIRECT_STATUSES.has(res.status)) return res;

    const location = res.headers.get('location');
    if (!location) return res; // redirect without target — treat as final

    // Drain the redirect body so the socket can be reused, then re-validate.
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore drain errors */
    }
    current = new URL(location, url).toString();
  }
  throw new Error('Too many redirects while proxying upstream');
}

/** Transform that aborts the stream once `maxBytes` is exceeded. */
function createByteLimiter(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new Error(`Upstream exceeded max byte limit of ${maxBytes}`));
        return;
      }
      cb(null, chunk);
    },
  });
}

/** Strip characters that could break out of the Content-Disposition header. */
function sanitizeFilename(name: string): string {
  // Remove CR/LF (header injection) and quotes/backslashes, cap length.
  return name.replace(/[\r"\\]/g, '').slice(0, 200) || 'download';
}

/** Parse the total size out of a `Content-Range: bytes a-b/total` header. */
function parseTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const m = /\/(\d+)$/.exec(contentRange);
  return m ? Number(m[1]) : null;
}

interface ChunkedOutcome {
  result: unknown;
  /** True when the response stream owns the lifecycle: the caller must
   *  NOT clear the timeout / detach the close listener — the stream's
   *  `close` handler does that when delivery ends or aborts. */
  handedOff: boolean;
}

/**
 * Stream a proxied upstream (googlevideo via the YouTube proxy list) in
 * bounded 1 MB chunks. The first chunk is fetched before replying so the
 * total size is known for headers and the 413 check; the remaining chunks
 * are fetched lazily as the client consumes the stream. A chunk that
 * fails or truncates is retried from the exact byte where delivery
 * stopped, so a flaky proxy degrades to a slower stream, not a corrupt
 * file. Returns early (handedOff: false) on any pre-stream failure.
 */
async function streamChunkedProxyResponse(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: ProxyPayload,
  logLabel: string,
  maxBytes: number,
  controller: AbortController,
  releaseTimer: () => void,
  detachClose: () => void,
): Promise<ChunkedOutcome> {
  const proxyIndex = payload.proxyIndex as number;
  const fail = (status: number, message: string): ChunkedOutcome => ({
    result: reply.code(status).send({ ok: false, error: { message } }),
    handedOff: false,
  });

  // Chunk 0: fetched eagerly — validates the pair and reveals the total.
  const first = await ssrfSafeFetch(
    payload.url,
    controller.signal,
    proxyIndex,
    `bytes=0-${PROXY_CHUNK_BYTES - 1}`,
  );
  if (first.status !== 206 && first.status !== 200) {
    req.log.warn(
      { status: first.status, proxyIndex },
      `${logLabel} upstream rejected the chunked fetch`,
    );
    return fail(502, `Upstream returned ${first.status}`);
  }

  const total =
    first.status === 206
      ? parseTotal(first.headers.get('content-range'))
      : Number(first.headers.get('content-length') || 0) || null;
  if (total !== null && total > maxBytes) {
    return fail(
      413,
      `File too large (${Math.round(total / 1024 / 1024)}MB, max ${Math.round(maxBytes / 1024 / 1024)}MB)`,
    );
  }

  const ct =
    payload.contentType || first.headers.get('content-type') || 'application/octet-stream';
  reply.header('content-type', ct);
  if (total) reply.header('content-length', String(total));
  if (payload.filename) {
    reply.header('content-disposition', `inline; filename="${sanitizeFilename(payload.filename)}"`);
  }
  reply.header('cache-control', 'private, max-age=3600');

  if (!first.body) {
    return { result: reply.code(204).send(), handedOff: false };
  }

  // Streaming has started: the single-shot timeout gives way to per-chunk
  // timeouts; the disconnect listener stays until the stream ends.
  releaseTimer();

  const fetchChunk = (start: number, end: number): Promise<Response> => {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    ]);
    return ssrfSafeFetch(payload.url, signal, proxyIndex, `bytes=${start}-${end}`);
  };

  // Bytes delivered so far; shared with the body reader so retries resume
  // from the exact offset where delivery stopped.
  const state = { position: 0 };

  async function* readBody(res: Response): AsyncGenerator<Buffer> {
    if (!res.body) return;
    const nodeStream = Readable.fromWeb(res.body as any);
    for await (const chunk of nodeStream) {
      const buf = chunk as Buffer;
      state.position += buf.length;
      yield buf;
    }
  }

  async function* bodies(): AsyncGenerator<Buffer> {
    yield* readBody(first);
    if (first.status === 200) return; // upstream ignored Range: whole file in one body
    while (total === null || state.position < total) {
      if (controller.signal.aborted) return;
      const chunkStart = state.position;
      const chunkEnd =
        total !== null
          ? Math.min(chunkStart + PROXY_CHUNK_BYTES - 1, total - 1)
          : chunkStart + PROXY_CHUNK_BYTES - 1;
      let attempts = 0;
      while (state.position <= chunkEnd) {
        attempts++;
        if (attempts > CHUNK_ATTEMPTS) {
          throw new Error(`chunk ${chunkStart}-${chunkEnd} gagal sesudah ${CHUNK_ATTEMPTS} percobaan`);
        }
        let res: Response;
        try {
          res = await fetchChunk(state.position, chunkEnd);
        } catch (err) {
          if (controller.signal.aborted) return;
          req.log.warn({ err, start: state.position }, `${logLabel} chunk fetch gagal, mencoba lagi`);
          continue;
        }
        if (res.status === 416) return; // past the end (stale total) — clean EOF
        if (res.status !== 206 && res.status !== 200) {
          try {
            await res.arrayBuffer();
          } catch {
            /* ignore drain errors */
          }
          req.log.warn(
            { status: res.status, start: state.position },
            `${logLabel} chunk ditolak upstream, mencoba lagi`,
          );
          continue;
        }
        try {
          yield* readBody(res);
        } catch (err) {
          if (controller.signal.aborted) return;
          req.log.warn({ err, start: state.position }, `${logLabel} chunk terputus, mencoba lagi`);
          continue;
        }
        if (res.status === 200) return;
      }
      // Unknown total: a short chunk means EOF.
      if (total === null && state.position - chunkStart < chunkEnd - chunkStart + 1) return;
    }
  }

  const limiter = createByteLimiter(maxBytes);
  const stream = Readable.from(bodies());
  stream.on('error', (err) => limiter.destroy(err));
  stream.on('close', () => {
    controller.abort();
    detachClose();
  });
  return { result: reply.send(stream.pipe(limiter)), handedOff: true };
}

/**
 * Stream the upstream media referenced by a verified proxy `payload` to the
 * client, applying SSRF and size protections. Sends the HTTP response itself.
 */
export async function streamProxyResponse(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: ProxyPayload,
  logLabel: string,
): Promise<unknown> {
  const maxBytes = loadEnv().DOWNLOAD_MAX_BYTES;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onClose = () => controller.abort();
  req.raw.on('close', onClose);
  let handedOff = false;

  try {
    // Proxied upstreams (YouTube resolver tokens) stream in bounded
    // chunks — see streamChunkedProxyResponse. Everything else keeps the
    // single-fetch path below, unchanged.
    if (payload.proxyIndex !== undefined) {
      const chunked = await streamChunkedProxyResponse(
        req,
        reply,
        payload,
        logLabel,
        maxBytes,
        controller,
        () => clearTimeout(timeout),
        () => req.raw.off('close', onClose),
      );
      handedOff = chunked.handedOff;
      return chunked.result;
    }

    const upstream = await ssrfSafeFetch(payload.url, controller.signal, payload.proxyIndex);

    // 206 Partial Content is expected when we send a Range header.
    if (!upstream.ok && upstream.status !== 206) {
      // Log the status: this branch used to fail silently, which made a
      // proxy 403 look like a mystery 502. No URL — it carries a signature.
      req.log.warn(
        { status: upstream.status, proxyIndex: payload.proxyIndex },
        `${logLabel} upstream rejected the fetch`,
      );
      return reply.code(502).send({
        ok: false,
        error: { message: `Upstream returned ${upstream.status}` },
      });
    }

    // Early reject using the (advisory) content-length when present.
    const clHeader =
      upstream.headers.get('content-length') ||
      upstream.headers.get('content-range')?.split('/')[1];
    const contentLength = Number(clHeader || 0);
    if (contentLength > maxBytes) {
      return reply.code(413).send({
        ok: false,
        error: {
          message: `File too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${Math.round(
            maxBytes / 1024 / 1024,
          )}MB)`,
        },
      });
    }

    const ct =
      payload.contentType || upstream.headers.get('content-type') || 'application/octet-stream';
    reply.header('content-type', ct);
    if (contentLength) reply.header('content-length', String(contentLength));
    if (payload.filename) {
      reply.header('content-disposition', `inline; filename="${sanitizeFilename(payload.filename)}"`);
    }
    reply.header('cache-control', 'private, max-age=3600');

    if (!upstream.body) {
      return reply.code(204).send();
    }

    // Enforce the byte cap on the actual streamed bytes (header is spoofable).
    const limiter = createByteLimiter(maxBytes);
    const nodeStream = Readable.fromWeb(upstream.body as any);
    nodeStream.on('error', (err) => limiter.destroy(err));
    return reply.send(nodeStream.pipe(limiter));
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return reply
        .code(499)
        .send({ ok: false, error: { message: 'Client disconnected or timeout' } });
    }
    req.log.error({ err, url: payload.url }, `${logLabel} stream failed`);
    return reply.code(502).send({ ok: false, error: { message: 'Failed to fetch upstream' } });
  } finally {
    // A handed-off chunked stream owns its lifecycle (its `close` handler
    // clears the timer and detaches the listener when delivery ends).
    if (!handedOff) {
      clearTimeout(timeout);
      req.raw.off('close', onClose);
    }
  }
}
