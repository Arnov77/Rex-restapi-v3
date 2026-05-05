// Vitest globals — see vitest.config.js.

const spotify = require('../src/core/music/adapters/spotify.adapter');
const apple = require('../src/core/music/adapters/apple.adapter');
const soundcloud = require('../src/core/music/adapters/soundcloud.adapter');
const musicService = require('../src/core/music/music.service');

describe('spotify.adapter URL matching', () => {
  it.each([
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', true, 'track'],
    ['https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy', true, 'album'],
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', true, 'playlist'],
    ['https://open.spotify.com/intl-id/track/4cOdK2wGLETKBW3PvgPWqT', true, 'track'],
    ['https://music.apple.com/us/album/lover/1468058165', false, null],
    ['https://example.com/track/abc', false, null],
  ])('matches(%s) → %s, kind=%s', (url, shouldMatch, kind) => {
    expect(spotify.matches(url)).toBe(shouldMatch);
    if (shouldMatch) {
      expect(spotify._classifyUrl(url)?.kind).toBe(kind);
    }
  });

  it('normalizeTrack converts spotidown JSON shape', () => {
    const t = spotify._normalizeTrack({
      id: 'abc',
      name: 'Song',
      artists: ['A1'],
      duration: 60000,
      album: { name: 'Album', releaseDate: '2020-01-01', coverUrl: 'http://cover' },
      audio: { url: 'http://audio', size: 1234 },
    });
    expect(t.id).toBe('abc');
    expect(t.title).toBe('Song');
    expect(t.durationSec).toBe(60);
    expect(t.audio.url).toBe('http://audio');
    expect(t.audio.format).toBe('mp3');
    expect(t.cover).toBe('http://cover');
    expect(t.sourceUrl).toBe('https://open.spotify.com/track/abc');
  });
});

describe('apple.adapter URL matching', () => {
  it.each([
    ['https://music.apple.com/us/album/lover/1468058165', true, 'album', '1468058165'],
    ['https://music.apple.com/us/album/lover/1468058165?i=1468058171', true, 'track', '1468058171'],
    ['https://music.apple.com/us/song/cruel-summer/1468058171', true, 'track', '1468058171'],
    ['https://music.apple.com/us/playlist/foo/pl.123', true, 'playlist', 'pl.123'],
    ['https://open.spotify.com/track/abc', false, null, null],
  ])('parseAppleUrl(%s) → %s', (url, shouldMatch, kind, id) => {
    expect(apple.matches(url)).toBe(shouldMatch);
    if (shouldMatch) {
      const parsed = apple._parseAppleUrl(url);
      expect(parsed?.kind).toBe(kind);
      expect(parsed?.id).toBe(id);
    }
  });

  it('trackFromItunesEntry rewrites artwork to 600x600', () => {
    const t = apple._trackFromItunesEntry(
      {
        trackId: 1,
        trackName: 'X',
        artistName: 'A',
        collectionName: 'C',
        artworkUrl100: 'https://is.example/100x100bb.jpg',
        trackTimeMillis: 120000,
        isrc: 'ISRC123',
        trackViewUrl: 'https://music.apple.com/x',
      },
      'src'
    );
    expect(t.cover).toBe('https://is.example/600x600bb.jpg');
    expect(t.durationSec).toBe(120);
    expect(t.isrc).toBe('ISRC123');
    expect(t.audio).toBeNull();
    expect(t.sourceUrl).toBe('https://music.apple.com/x');
  });

  it('rejects playlist URLs at resolve()', async () => {
    await expect(apple.resolve('https://music.apple.com/us/playlist/foo/pl.123')).rejects.toThrow(
      /playlist URLs are not supported/i
    );
  });
});

describe('soundcloud.adapter URL matching', () => {
  it.each([
    ['https://soundcloud.com/forss/flickermood', true],
    ['https://soundcloud.com/user-123/sets/my-mix', true],
    ['https://m.soundcloud.com/forss/flickermood', true],
    ['https://music.apple.com/us/album/lover/1468058165', false],
    ['https://example.com', false],
  ])('matches(%s) → %s', (url, expected) => {
    expect(soundcloud.matches(url)).toBe(expected);
  });

  it('trackFromYtDlp shapes a yt-dlp dump correctly', () => {
    const t = soundcloud._trackFromYtDlp(
      {
        id: '293',
        track: 'Flickermood',
        artist: 'Forss',
        duration: 214,
        upload_date: '20070922',
        thumbnail: 'http://thumb',
        webpage_url: 'http://sc',
      },
      null
    );
    expect(t.id).toBe('293');
    expect(t.title).toBe('Flickermood');
    expect(t.artists).toEqual(['Forss']);
    expect(t.durationSec).toBe(214);
    expect(t.releaseDate).toBe('2007-09-22');
    expect(t.audio).toBeNull();
  });
});

describe('music.service detectService + buildYouTubeQuery', () => {
  it.each([
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 'spotify'],
    ['https://music.apple.com/us/album/lover/1', 'apple'],
    ['https://soundcloud.com/x/y', 'soundcloud'],
    ['https://example.com', null],
  ])('detectService(%s)', (url, expected) => {
    expect(musicService.detectService(url)).toBe(expected);
  });

  it('buildYouTubeQuery joins artist + title', () => {
    expect(
      musicService._buildYouTubeQuery({
        artists: ['Rick Astley'],
        title: 'Never Gonna Give You Up',
      })
    ).toBe('Rick Astley Never Gonna Give You Up');
    expect(musicService._buildYouTubeQuery({ artists: [], title: 'Solo' })).toBe('Solo');
    expect(musicService._buildYouTubeQuery({ artists: ['Foo'], title: '' })).toBe('Foo');
  });

  it('rejects unsupported URL hosts at resolve()', async () => {
    await expect(musicService.resolve('https://example.com')).rejects.toThrow(
      /host not supported/i
    );
  });

  it('rejects empty url at resolve()', async () => {
    await expect(musicService.resolve('')).rejects.toThrow(/required/i);
  });
});
