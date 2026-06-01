import dns from 'node:dns/promises';
import net from 'node:net';
import { BadRequest } from '../errors.js';
/**
 * SSRF guard for outbound HTTP fetchers (Playwright, axios, fetch). Resolves
 * the URL hostname via DNS and rejects when ANY answer falls into a private,
 * loopback, link-local, or cloud-metadata range (IPv4 + IPv6).
 *
 * Caveat: this is a TOCTOU check — a DNS-rebinding attacker can return a
 * public IP at lookup time and a private IP at the consumer's resolver call.
 * Treat it as a strong baseline, not absolute defence.
 */
const FORBIDDEN_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'broadcasthost']);
export function isPrivateIPv4(ip) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
        return false;
    const [a, b, c] = parts;
    if (a === 10)
        return true;
    if (a === 127)
        return true;
    if (a === 0)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 192 && b === 0 && c === 0)
        return true;
    if (a === 198 && (b === 18 || b === 19))
        return true;
    if (a >= 224)
        return true;
    return false;
}
function expandIPv6(ip) {
    const stripped = (ip.split('%')[0] ?? '').toLowerCase();
    if (stripped === '::')
        return '0:0:0:0:0:0:0:0';
    let head;
    let tail;
    if (stripped.includes('::')) {
        const [h = '', t = ''] = stripped.split('::');
        head = h ? h.split(':') : [];
        tail = t ? t.split(':') : [];
    }
    else {
        head = stripped.split(':');
        tail = [];
    }
    const last = tail[tail.length - 1];
    if (last && last.includes('.')) {
        const v4 = tail.pop();
        const v4parts = v4.split('.').map((p) => Number(p));
        const [p0 = 0, p1 = 0, p2 = 0, p3 = 0] = v4parts;
        tail.push((((p0 << 8) | p1) >>> 0).toString(16), (((p2 << 8) | p3) >>> 0).toString(16));
    }
    const fill = 8 - head.length - tail.length;
    const groups = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail];
    return groups.map((g) => parseInt(g || '0', 16).toString(16)).join(':');
}
export function isPrivateIPv6(ip) {
    const expanded = expandIPv6(ip);
    const groups = expanded.split(':');
    if (groups.length !== 8)
        return true;
    const first = parseInt(groups[0], 16);
    if (groups.every((g, i) => (i < 7 ? g === '0' : g === '1')))
        return true;
    if (groups.every((g) => g === '0'))
        return true;
    if ((first & 0xfe00) === 0xfc00)
        return true;
    if ((first & 0xffc0) === 0xfe80)
        return true;
    if ((first & 0xff00) === 0xff00)
        return true;
    if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
        const hi = parseInt(groups[6], 16);
        const lo = parseInt(groups[7], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIPv4(v4);
    }
    if (groups.slice(0, 6).every((g) => g === '0') && (groups[6] !== '0' || groups[7] !== '0')) {
        const hi = parseInt(groups[6], 16);
        const lo = parseInt(groups[7], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIPv4(v4);
    }
    return false;
}
export function isPrivateIP(ip) {
    const family = net.isIP(ip);
    if (family === 4)
        return isPrivateIPv4(ip);
    if (family === 6)
        return isPrivateIPv6(ip);
    return true;
}
export async function assertPublicUrl(rawUrl, opts = {}) {
    const allowedSchemes = opts.allowedSchemes ?? ['http:', 'https:'];
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        throw BadRequest('Invalid URL');
    }
    if (!allowedSchemes.includes(url.protocol)) {
        throw BadRequest(`URL scheme must be one of: ${allowedSchemes.join(', ')}`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname)
        throw BadRequest('URL must include a hostname');
    if (FORBIDDEN_HOSTNAMES.has(hostname)) {
        throw BadRequest('URL hostname is not allowed (loopback alias)');
    }
    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname))
            throw BadRequest('URL points to a private or reserved IP address');
        return url;
    }
    const resolver = opts.resolver ?? ((host) => dns.lookup(host, { all: true, verbatim: true }));
    let answers;
    try {
        answers = await resolver(hostname);
    }
    catch (err) {
        const code = err.code ?? err.message;
        throw BadRequest(`DNS lookup failed for "${hostname}": ${code}`);
    }
    if (!answers.length)
        throw BadRequest(`DNS lookup returned no answers for "${hostname}"`);
    for (const { address } of answers) {
        if (isPrivateIP(address)) {
            throw BadRequest(`URL hostname "${hostname}" resolves to a private/reserved IP and is blocked`);
        }
    }
    return url;
}
//# sourceMappingURL=ssrfGuard.js.map