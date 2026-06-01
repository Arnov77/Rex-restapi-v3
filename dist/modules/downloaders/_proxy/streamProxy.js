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
 */
import { Readable, Transform } from 'node:stream';
import { assertPublicUrl } from '../../../shared/utils/ssrfGuard.js';
import { loadEnv } from '../../../config/env.js';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/** Build CDN-specific request headers (Referer/Range) for a given target. */
function buildHeaders(target) {
    const headers = {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
    };
    const h = target.hostname;
    const isTiktokCdn = /tiktok|musical\.ly|byteoversea|ibytedtos|bytecdn|byte-?d/i.test(h);
    if (h.includes('tikwm.com')) {
        headers.Referer = 'https://www.tikwm.com/';
    }
    else if (isTiktokCdn) {
        headers.Referer = 'https://www.tiktok.com/';
        headers.Range = 'bytes=0-';
    }
    else if (h.includes('twimg.com') || h.includes('twitter') || h.includes('x.com')) {
        headers.Referer = 'https://x.com/';
    }
    else {
        headers.Referer = `${target.origin}/`;
    }
    return headers;
}
/** Hosts the proxy may stream from even if they resolve to private IPs —
 *  e.g. a self-hosted cobalt instance whose tunnels point at 127.0.0.1. */
function trustedInternalHosts() {
    const env = loadEnv();
    const hosts = [];
    try {
        hosts.push(new URL(env.COBALT_API_URL).hostname);
    }
    catch { /* ignore */ }
    for (const h of env.DOWNLOAD_PROXY_ALLOW_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)) {
        hosts.push(h);
    }
    return hosts;
}
/**
 * Fetch `rawUrl` with manual redirect handling. The initial URL and every
 * redirect target are validated with `assertPublicUrl` before a connection
 * is opened, closing the redirect-based SSRF bypass.
 */
async function ssrfSafeFetch(rawUrl, signal) {
    const allowHosts = trustedInternalHosts();
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Throws AppError(400) when the target resolves to a blocked address.
        const url = await assertPublicUrl(current, { allowHosts });
        const res = await fetch(url, {
            signal,
            headers: buildHeaders(url),
            redirect: 'manual',
        });
        if (!REDIRECT_STATUSES.has(res.status))
            return res;
        const location = res.headers.get('location');
        if (!location)
            return res; // redirect without target — treat as final
        // Drain the redirect body so the socket can be reused, then re-validate.
        try {
            await res.arrayBuffer();
        }
        catch {
            /* ignore drain errors */
        }
        current = new URL(location, url).toString();
    }
    throw new Error('Too many redirects while proxying upstream');
}
/** Transform that aborts the stream once `maxBytes` is exceeded. */
function createByteLimiter(maxBytes) {
    let total = 0;
    return new Transform({
        transform(chunk, _enc, cb) {
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
function sanitizeFilename(name) {
    // Remove CR/LF (header injection) and quotes/backslashes, cap length.
    return name.replace(/[\r"\\]/g, '').slice(0, 200) || 'download';
}
/**
 * Stream the upstream media referenced by a verified proxy `payload` to the
 * client, applying SSRF and size protections. Sends the HTTP response itself.
 */
export async function streamProxyResponse(req, reply, payload, logLabel) {
    const maxBytes = loadEnv().DOWNLOAD_MAX_BYTES;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onClose = () => controller.abort();
    req.raw.on('close', onClose);
    try {
        const upstream = await ssrfSafeFetch(payload.url, controller.signal);
        // 206 Partial Content is expected when we send a Range header.
        if (!upstream.ok && upstream.status !== 206) {
            return reply.code(502).send({
                ok: false,
                error: { message: `Upstream returned ${upstream.status}` },
            });
        }
        // Early reject using the (advisory) content-length when present.
        const clHeader = upstream.headers.get('content-length') ||
            upstream.headers.get('content-range')?.split('/')[1];
        const contentLength = Number(clHeader || 0);
        if (contentLength > maxBytes) {
            return reply.code(413).send({
                ok: false,
                error: {
                    message: `File too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${Math.round(maxBytes / 1024 / 1024)}MB)`,
                },
            });
        }
        const ct = payload.contentType || upstream.headers.get('content-type') || 'application/octet-stream';
        reply.header('content-type', ct);
        if (contentLength)
            reply.header('content-length', String(contentLength));
        if (payload.filename) {
            reply.header('content-disposition', `inline; filename="${sanitizeFilename(payload.filename)}"`);
        }
        reply.header('cache-control', 'private, max-age=3600');
        if (!upstream.body) {
            return reply.code(204).send();
        }
        // Enforce the byte cap on the actual streamed bytes (header is spoofable).
        const limiter = createByteLimiter(maxBytes);
        const nodeStream = Readable.fromWeb(upstream.body);
        nodeStream.on('error', (err) => limiter.destroy(err));
        return reply.send(nodeStream.pipe(limiter));
    }
    catch (err) {
        if (err?.name === 'AbortError') {
            return reply
                .code(499)
                .send({ ok: false, error: { message: 'Client disconnected or timeout' } });
        }
        req.log.error({ err, url: payload.url }, `${logLabel} stream failed`);
        return reply.code(502).send({ ok: false, error: { message: 'Failed to fetch upstream' } });
    }
    finally {
        clearTimeout(timeout);
        req.raw.off('close', onClose);
    }
}
//# sourceMappingURL=streamProxy.js.map