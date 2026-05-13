const fs = require('fs');
const {
  parseNetscape,
  buildCookieHeader,
  decodeYouTubeCookiesB64,
  writeNetscapeTmp,
  unlinkSilent,
  loadYouTubeCookies,
} = require('../src/shared/utils/cookies');

const SAMPLE_NETSCAPE = [
  '# Netscape HTTP Cookie File',
  '# https://curl.se/docs/http-cookies.html',
  '',
  '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tVISITOR_INFO1_LIVE\tabc123',
  '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSAPISID\tsecret-value',
  '.google.com\tTRUE\t/\tFALSE\t0\tCONSENT\tYES+srp.gws',
  '# comment line ignored',
  'malformed line with no tabs',
  '.example.com\tTRUE\t/\tTRUE\t1893456000\tIRRELEVANT\tnope',
  '',
].join('\n');

describe('parseNetscape', () => {
  it('parses tab-delimited rows into cookie objects', () => {
    const cookies = parseNetscape(SAMPLE_NETSCAPE);
    expect(cookies).toHaveLength(4);
    const visitor = cookies.find((c) => c.name === 'VISITOR_INFO1_LIVE');
    expect(visitor).toMatchObject({
      domain: '.youtube.com',
      path: '/',
      secure: true,
      httpOnly: false,
      expires: 1893456000,
      value: 'abc123',
    });
  });

  it('honours the #HttpOnly_ prefix', () => {
    const cookies = parseNetscape(SAMPLE_NETSCAPE);
    const sapisid = cookies.find((c) => c.name === 'SAPISID');
    expect(sapisid).toBeDefined();
    expect(sapisid.httpOnly).toBe(true);
    expect(sapisid.value).toBe('secret-value');
  });

  it('skips comments, blank lines, and rows with too few columns', () => {
    const cookies = parseNetscape(SAMPLE_NETSCAPE);
    const names = cookies.map((c) => c.name);
    expect(names).not.toContain('# comment line ignored');
    expect(names).not.toContain('malformed');
  });

  it('returns [] for null/non-string/empty input', () => {
    expect(parseNetscape(null)).toEqual([]);
    expect(parseNetscape(undefined)).toEqual([]);
    expect(parseNetscape('')).toEqual([]);
    expect(parseNetscape(42)).toEqual([]);
  });
});

describe('buildCookieHeader', () => {
  it('emits "name=value; ..." filtered to YouTube/Google domains by default', () => {
    const cookies = parseNetscape(SAMPLE_NETSCAPE);
    const header = buildCookieHeader(cookies);
    expect(header).toContain('VISITOR_INFO1_LIVE=abc123');
    expect(header).toContain('SAPISID=secret-value');
    expect(header).toContain('CONSENT=YES+srp.gws');
    expect(header).not.toContain('IRRELEVANT');
  });

  it('deduplicates cookies by name (first wins)', () => {
    const cookies = [
      { domain: '.youtube.com', name: 'X', value: 'first' },
      { domain: '.youtube.com', name: 'X', value: 'second' },
    ];
    expect(buildCookieHeader(cookies)).toBe('X=first');
  });

  it('returns "" for empty/non-array input', () => {
    expect(buildCookieHeader(null)).toBe('');
    expect(buildCookieHeader([])).toBe('');
  });
});

describe('decodeYouTubeCookiesB64', () => {
  const ORIGINAL = process.env.YOUTUBE_COOKIES_B64;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.YOUTUBE_COOKIES_B64;
    else process.env.YOUTUBE_COOKIES_B64 = ORIGINAL;
  });

  it('returns null when env var is unset', () => {
    delete process.env.YOUTUBE_COOKIES_B64;
    expect(decodeYouTubeCookiesB64()).toBeNull();
  });

  it('decodes a valid base64 payload', () => {
    process.env.YOUTUBE_COOKIES_B64 = Buffer.from(SAMPLE_NETSCAPE, 'utf-8').toString('base64');
    const out = decodeYouTubeCookiesB64();
    expect(out).toContain('VISITOR_INFO1_LIVE');
  });
});

describe('loadYouTubeCookies', () => {
  const ORIGINAL = process.env.YOUTUBE_COOKIES_B64;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.YOUTUBE_COOKIES_B64;
    else process.env.YOUTUBE_COOKIES_B64 = ORIGINAL;
  });

  it('returns null when env var is unset', () => {
    delete process.env.YOUTUBE_COOKIES_B64;
    expect(loadYouTubeCookies()).toBeNull();
  });

  it('returns parsed cookies + header + write() helper when env is set', () => {
    process.env.YOUTUBE_COOKIES_B64 = Buffer.from(SAMPLE_NETSCAPE, 'utf-8').toString('base64');
    const data = loadYouTubeCookies();
    expect(data).not.toBeNull();
    expect(data.cookies.length).toBeGreaterThanOrEqual(3);
    expect(data.header).toContain('VISITOR_INFO1_LIVE=abc123');
    expect(typeof data.write).toBe('function');

    const tmpPath = data.write();
    try {
      expect(fs.existsSync(tmpPath)).toBe(true);
      const onDisk = fs.readFileSync(tmpPath, 'utf-8');
      expect(onDisk).toContain('VISITOR_INFO1_LIVE');
    } finally {
      unlinkSilent(tmpPath);
      expect(fs.existsSync(tmpPath)).toBe(false);
    }
  });

  it('returns null when decoded content has zero parseable cookies', () => {
    process.env.YOUTUBE_COOKIES_B64 = Buffer.from('# only comments\n', 'utf-8').toString('base64');
    expect(loadYouTubeCookies()).toBeNull();
  });
});

describe('writeNetscapeTmp / unlinkSilent', () => {
  it('writes a 0600 file and unlinkSilent removes it without throwing', () => {
    const p = writeNetscapeTmp('# hello\n');
    expect(fs.existsSync(p)).toBe(true);
    const stat = fs.statSync(p);
    // Lower 9 bits hold the mode; 0o600 = owner rw only
    expect(stat.mode & 0o777).toBe(0o600);
    unlinkSilent(p);
    expect(fs.existsSync(p)).toBe(false);
    expect(() => unlinkSilent(p)).not.toThrow();
    expect(() => unlinkSilent(null)).not.toThrow();
  });
});
