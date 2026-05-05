// Vitest globals (describe/it/expect/vi/beforeEach) — see vitest.config.js.

const dns = require('dns/promises');
const {
  assertPublicUrl,
  isPrivateIP,
  isPrivateIPv4,
  isPrivateIPv6,
  expandIPv6,
} = require('../src/shared/utils/ssrfGuard');

const realLookup = dns.lookup;

function setLookup(answers) {
  dns.lookup = async () => answers;
}

function failLookup(code) {
  dns.lookup = async () => {
    throw Object.assign(new Error('mocked dns failure'), { code });
  };
}

afterEach(() => {
  dns.lookup = realLookup;
});

describe('ssrfGuard.isPrivateIPv4', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.15.0.1', false],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['192.0.0.1', true],
    ['169.254.169.254', true],
    ['198.18.0.1', true],
    ['224.0.0.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['0.0.0.0', true],
    ['203.0.113.1', false],
  ])('%s -> private=%s', (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });
});

describe('ssrfGuard.expandIPv6', () => {
  it.each([
    ['::1', '0:0:0:0:0:0:0:1'],
    ['::', '0:0:0:0:0:0:0:0'],
    ['fe80::1', 'fe80:0:0:0:0:0:0:1'],
    ['fc00::1', 'fc00:0:0:0:0:0:0:1'],
    ['2001:db8::1', '2001:db8:0:0:0:0:0:1'],
  ])('%s -> %s', (input, expected) => {
    expect(expandIPv6(input)).toBe(expected);
  });
});

describe('ssrfGuard.isPrivateIPv6', () => {
  it.each([
    ['::1', true],
    ['::', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['ff02::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['2606:4700:4700::1111', false],
    ['2001:4860:4860::8888', false],
  ])('%s -> private=%s', (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

describe('ssrfGuard.isPrivateIP', () => {
  it('rejects non-IP strings', () => {
    expect(isPrivateIP('example.com')).toBe(true);
    expect(isPrivateIP('not.an.ip')).toBe(true);
  });

  it('classifies IPv4 and IPv6 correctly', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('2606:4700:4700::1111')).toBe(false);
  });
});

describe('ssrfGuard.assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(assertPublicUrl('javascript:alert(1)')).rejects.toThrow(/scheme/i);
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow(/scheme/i);
  });

  it('rejects malformed URLs', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('rejects literal "localhost" hostname', async () => {
    await expect(assertPublicUrl('http://localhost/admin')).rejects.toThrow(/loopback alias/);
  });

  it('rejects literal IPv4 loopback without DNS lookup', async () => {
    let called = false;
    dns.lookup = async () => {
      called = true;
      return [];
    };
    await expect(assertPublicUrl('http://127.0.0.1:8080/')).rejects.toThrow(/private/);
    expect(called).toBe(false);
  });

  it('rejects literal IPv6 loopback', async () => {
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private/);
  });

  it('rejects cloud metadata IP (169.254.169.254)', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private/
    );
  });

  it('rejects RFC1918 IPs', async () => {
    await expect(assertPublicUrl('http://10.0.0.1/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://172.20.5.5/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow(/private/);
  });

  it('rejects hostname that resolves to private IP', async () => {
    setLookup([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertPublicUrl('http://internal.evil.com/')).rejects.toThrow(/blocked/);
  });

  it('rejects hostname when ANY answer is private (DNS-rebinding-ish)', async () => {
    setLookup([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(assertPublicUrl('http://mixed.example.com/')).rejects.toThrow(/blocked/);
  });

  it('rejects hostname that resolves to IPv6 link-local', async () => {
    setLookup([{ address: 'fe80::1', family: 6 }]);
    await expect(assertPublicUrl('http://v6-link-local.example.com/')).rejects.toThrow(/blocked/);
  });

  it('accepts hostname that resolves to public IPs', async () => {
    setLookup([{ address: '93.184.216.34', family: 4 }]);
    const url = await assertPublicUrl('https://example.com/');
    expect(url.hostname).toBe('example.com');
  });

  it('treats DNS lookup failure as a hard reject', async () => {
    failLookup('ENOTFOUND');
    await expect(assertPublicUrl('https://nx.invalid/')).rejects.toThrow(/DNS lookup failed/);
  });
});
