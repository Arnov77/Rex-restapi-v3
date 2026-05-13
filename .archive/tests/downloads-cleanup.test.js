const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepOnce } = require('../src/shared/utils/downloadsCleanup');

function mkdirTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'downloads-cleanup-'));
}

function touchOld(p, ageMs) {
  fs.writeFileSync(p, 'x');
  const past = Date.now() - ageMs;
  fs.utimesSync(p, past / 1000, past / 1000);
}

describe('downloadsCleanup.sweepOnce', () => {
  let dir;

  beforeEach(() => {
    dir = mkdirTmp();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('deletes files older than the TTL and keeps recent ones', () => {
    const oldFile = path.join(dir, 'old.mp3');
    const newFile = path.join(dir, 'new.mp4');
    touchOld(oldFile, 2 * 60 * 60 * 1000); // 2h old
    fs.writeFileSync(newFile, 'y'); // just-now mtime

    const result = sweepOnce(dir, 60 * 60 * 1000); // 1h ttl

    expect(result).toMatchObject({ deleted: 1, kept: 1, failed: 0 });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('returns zero counts and no error when the dir is missing', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    const result = sweepOnce(dir, 60 * 60 * 1000);
    expect(result).toEqual({ deleted: 0, kept: 0, failed: 0 });
  });

  it('skips subdirectories instead of deleting them', () => {
    const sub = path.join(dir, 'subdir');
    fs.mkdirSync(sub);
    const oldFile = path.join(dir, 'old.txt');
    touchOld(oldFile, 2 * 60 * 60 * 1000);

    const result = sweepOnce(dir, 60 * 60 * 1000);

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(sub)).toBe(true);
  });
});
