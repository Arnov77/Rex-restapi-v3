const dns = require('dns/promises');
const net = require('net');
const { ValidationError } = require('./errors');

/**
 * SSRF guard for outbound HTTP fetchers. Resolves the URL hostname via DNS
 * and rejects when ANY answer falls into a private / loopback / link-local /
 * cloud-metadata range (IPv4 or IPv6).
 *
 * Limitation: this is a TOCTOU check. A DNS rebinding attacker could return
 * a public IP at lookup time and a private IP at the consumer's own resolver
 * call. Mitigations require pinning the resolved IP (Host header / SNI), which
 * is intrusive for headless-browser callers. Treat this guard as a strong
 * baseline, not an absolute defence.
 */

const FORBIDDEN_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'broadcasthost']);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // 224+ multicast / reserved
  return false;
}

function expandIPv6(ip) {
  // Strip zone id (e.g. fe80::1%eth0)
  const stripped = ip.split('%')[0].toLowerCase();
  if (stripped === '::') return '0:0:0:0:0:0:0:0';

  // Handle :: shorthand
  let head;
  let tail;
  if (stripped.includes('::')) {
    const [h, t] = stripped.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
  } else {
    head = stripped.split(':');
    tail = [];
  }

  // IPv4-mapped tail like ::ffff:127.0.0.1 — convert to two 16-bit groups
  const lastTail = tail[tail.length - 1];
  if (lastTail && lastTail.includes('.')) {
    const v4 = tail.pop();
    const v4parts = v4.split('.').map((p) => Number(p));
    const hi = ((v4parts[0] << 8) | v4parts[1]).toString(16);
    const lo = ((v4parts[2] << 8) | v4parts[3]).toString(16);
    tail.push(hi, lo);
  }

  const fillCount = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(0, fillCount)).fill('0'), ...tail];
  return groups.map((g) => parseInt(g || '0', 16).toString(16)).join(':');
}

function isPrivateIPv6(ip) {
  const expanded = expandIPv6(ip);
  const groups = expanded.split(':');
  if (groups.length !== 8) return true; // malformed → treat as forbidden
  const first = parseInt(groups[0], 16);

  // ::1 loopback
  if (groups.every((g, i) => (i < 7 ? g === '0' : g === '1'))) return true;
  // :: unspecified
  if (groups.every((g) => g === '0')) return true;
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return true;
  // ::ffff:0:0/96 IPv4-mapped → check the embedded v4
  if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateIPv4(v4);
  }
  // ::a.b.c.d IPv4-compatible (deprecated but still a footgun)
  if (groups.slice(0, 6).every((g) => g === '0') && (groups[6] !== '0' || groups[7] !== '0')) {
    const hi = parseInt(groups[6], 16);
    const lo = parseInt(groups[7], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateIPv4(v4);
  }

  return false;
}

function isPrivateIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not an IP literal → caller should not have passed it
}

/**
 * Validate a URL against SSRF rules. Throws ValidationError when the URL is
 * a private/loopback/metadata target. Returns the parsed URL on success.
 */
async function assertPublicUrl(rawUrl, { allowedSchemes = ['http:', 'https:'] } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid URL');
  }

  if (!allowedSchemes.includes(url.protocol)) {
    throw new ValidationError(`URL scheme must be one of: ${allowedSchemes.join(', ')}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new ValidationError('URL must include a hostname');
  if (FORBIDDEN_HOSTNAMES.has(hostname)) {
    throw new ValidationError('URL hostname is not allowed (loopback alias)');
  }

  // Hostname may already be an IP literal — check directly without DNS.
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new ValidationError('URL points to a private or reserved IP address');
    }
    return url;
  }

  // Resolve and check every answer. lookup({all: true}) returns A + AAAA.
  let answers;
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new ValidationError(`DNS lookup failed for "${hostname}": ${err.code || err.message}`);
  }

  if (!answers.length) {
    throw new ValidationError(`DNS lookup returned no answers for "${hostname}"`);
  }

  for (const { address } of answers) {
    if (isPrivateIP(address)) {
      throw new ValidationError(
        `URL hostname "${hostname}" resolves to a private/reserved IP and is blocked`
      );
    }
  }

  return url;
}

module.exports = {
  assertPublicUrl,
  isPrivateIP,
  isPrivateIPv4,
  isPrivateIPv6,
  expandIPv6,
};
