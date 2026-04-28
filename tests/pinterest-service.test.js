const { _internal } = require('../src/core/media/pinterest/pinterest.service');

describe('pinterest.upgradePinimgUrl', () => {
  const cases = [
    [
      'https://i.pinimg.com/736x/52/f9/0c/52f90c7e8594a6cdca1da81ac5e865f2.jpg',
      'https://i.pinimg.com/originals/52/f9/0c/52f90c7e8594a6cdca1da81ac5e865f2.jpg',
    ],
    [
      'https://i.pinimg.com/236x/ab/cd/ef/abcdef0123456789.jpg',
      'https://i.pinimg.com/originals/ab/cd/ef/abcdef0123456789.jpg',
    ],
    [
      'https://i.pinimg.com/75x75_RS/ab/cd/ef/abcdef.jpg',
      'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg',
    ],
    [
      'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg',
      'https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg',
    ],
    ['', ''],
    ['https://example.com/something.jpg', 'https://example.com/something.jpg'],
  ];

  it.each(cases)('upgrades %s', (input, expected) => {
    expect(_internal.upgradePinimgUrl(input)).toBe(expected);
  });
});

describe('pinterest.extractMeta', () => {
  const html = `
    <meta property="og:title" content="Test Pin"/>
    <meta name="og:image" content="https://i.pinimg.com/736x/aa/bb/cc/test.jpg"/>
    <meta content="https://example.com/video.mp4" property="og:video"/>
  `;

  it('finds property=og:title', () => {
    expect(_internal.extractMeta(html, 'og:title')).toBe('Test Pin');
  });

  it('finds name=og:image', () => {
    expect(_internal.extractMeta(html, 'og:image')).toBe(
      'https://i.pinimg.com/736x/aa/bb/cc/test.jpg'
    );
  });

  it('finds content-before-property variant', () => {
    expect(_internal.extractMeta(html, 'og:video')).toBe('https://example.com/video.mp4');
  });

  it('returns null when prop missing', () => {
    expect(_internal.extractMeta(html, 'og:nonexistent')).toBeNull();
  });
});
