const { _internal } = require('../src/core/media/twitter/twitter.service');

describe('twitter.extractTweetId', () => {
  const cases = [
    ['https://x.com/elonmusk/status/1349129669258448897', '1349129669258448897'],
    ['https://twitter.com/jack/status/20', null],
    ['https://twitter.com/jack/status/200000000000', '200000000000'],
    ['https://twitter.com/elonmusk/status/1349129669258448897/photo/1', '1349129669258448897'],
    ['https://x.com/elonmusk', null],
    ['https://example.com/status/123', null],
    ['not-a-url-at-all', null],
  ];

  it.each(cases)('extracts id from %s', (url, expected) => {
    expect(_internal.extractTweetId(url)).toBe(expected);
  });
});
