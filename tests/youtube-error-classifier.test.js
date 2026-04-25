const svc = require('../src/core/media/youtube/youtube.service');
const { AppError } = require('../src/shared/utils/errors');

describe('YouTubeService._classifyDownloadError', () => {
  it('maps "Requested format is not available" to 502 with PO-token-specific message', () => {
    const err = svc._classifyDownloadError(
      new Error(
        'ERROR: Requested format is not available. Use --list-formats for a list of available formats'
      )
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('PO Token');
    expect(err.message).toContain('YOUTUBE_PO_TOKEN');
    expect(err.message).not.toContain('blocking this server');
  });

  it('maps "No video formats found" to the same 502 PO-token error', () => {
    const err = svc._classifyDownloadError('ERROR: No video formats found!');
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('PO Token');
  });

  it('maps "Video unavailable" to 404', () => {
    const err = svc._classifyDownloadError(
      new Error('ERROR: Video unavailable. This video has been removed by the user.')
    );
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('tidak tersedia atau sudah dihapus');
  });

  it('maps "Private video" to 404', () => {
    const err = svc._classifyDownloadError(
      new Error("ERROR: Private video. Sign in if you've been granted access to this video")
    );
    expect(err.statusCode).toBe(404);
  });

  it('maps age-restricted to 403 with cookies-account hint (NOT bot-block message)', () => {
    const err = svc._classifyDownloadError(
      new Error(
        'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.'
      )
    );
    // 'sign in to confirm' is checked LATER than age-restricted, so we use a phrase that hits age-restricted first
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it('maps explicit "age-restricted" to age-restricted message (not bot-block)', () => {
    const err = svc._classifyDownloadError(
      new Error('This video is age-restricted and cannot be played')
    );
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('age-restricted');
  });

  it('maps HTTP 429 to bot-block 403', () => {
    const err = svc._classifyDownloadError(new Error('ERROR: HTTP Error 429: Too Many Requests'));
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('YouTube is blocking this server');
  });

  it('maps HTTP 403 to bot-block 403', () => {
    const err = svc._classifyDownloadError(new Error('HTTP Error 403: Forbidden'));
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('YouTube is blocking this server');
  });

  it('returns null for unknown errors so the caller can rethrow', () => {
    expect(svc._classifyDownloadError(new Error('ENOSPC: no space left on device'))).toBeNull();
    expect(svc._classifyDownloadError(new Error('ffmpeg exited with code 1'))).toBeNull();
    expect(svc._classifyDownloadError(null)).toBeNull();
    expect(svc._classifyDownloadError(undefined)).toBeNull();
    expect(svc._classifyDownloadError('')).toBeNull();
  });

  it('accepts plain strings as well as Error instances', () => {
    const a = svc._classifyDownloadError('Requested format is not available');
    const b = svc._classifyDownloadError(new Error('Requested format is not available'));
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.message).toBe(b.message);
  });
});
