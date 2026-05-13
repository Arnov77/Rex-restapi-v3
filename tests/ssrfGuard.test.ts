import './setupEnv.js';
import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateIPv4, isPrivateIPv6 } from '../src/shared/utils/ssrfGuard.js';

const ok = (addr: string) => async () => [{ address: addr }];
const fail = async () => {
  const e: NodeJS.ErrnoException = new Error('not found');
  e.code = 'ENOTFOUND';
  throw e;
};

describe('ssrfGuard primitives', () => {
  it.each([
    ['10.0.0.1', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true], // AWS/GCP metadata
    ['172.20.0.5', true],
    ['192.168.1.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
  ])('isPrivateIPv4(%s) === %s', (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });

  it.each([
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['::ffff:127.0.0.1', true],
    ['2001:4860:4860::8888', false],
  ])('isPrivateIPv6(%s) === %s', (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

describe('assertPublicUrl', () => {
  it('rejects malformed URLs', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('ftp://example.com')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each(['http://localhost/x', 'https://localhost.localdomain/'])(
    'rejects loopback alias %s',
    async (u) => {
      await expect(assertPublicUrl(u)).rejects.toMatchObject({ statusCode: 400 });
    },
  );

  it('rejects IP literals in private ranges without DNS', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toMatchObject({ statusCode: 400 });
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(assertPublicUrl('http://[::1]/')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts public IP literals without calling DNS', async () => {
    const url = await assertPublicUrl('http://8.8.8.8/');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('rejects when DNS resolves to a private address', async () => {
    await expect(
      assertPublicUrl('http://internal.example.com/', { resolver: ok('10.0.0.5') }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when ANY answer is private (mixed-answer attack)', async () => {
    const resolver = async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }];
    await expect(
      assertPublicUrl('http://example.com/', { resolver }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts when DNS resolves to a public address', async () => {
    const url = await assertPublicUrl('http://example.com/path', { resolver: ok('93.184.216.34') });
    expect(url.pathname).toBe('/path');
  });

  it('wraps DNS lookup failure as BadRequest', async () => {
    await expect(
      assertPublicUrl('http://nx.example.com/', { resolver: fail }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('ENOTFOUND') });
  });

  it('rejects when DNS returns no answers', async () => {
    await expect(
      assertPublicUrl('http://empty.example.com/', { resolver: async () => [] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
