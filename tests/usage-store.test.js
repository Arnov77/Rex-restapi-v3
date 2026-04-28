const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpRoot;
let store;

function loadFresh() {
  delete require.cache[require.resolve('../src/shared/auth/usageStore')];
  store = require('../src/shared/auth/usageStore');
  store._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-usage-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  loadFresh();
});

afterEach(() => {
  if (store) store.stop();
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.unlinkSync(realDataDir);
  }
  const backup = path.join(__dirname, '..', `data.bak-${process.pid}`);
  if (fs.existsSync(backup)) fs.renameSync(backup, realDataDir);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('usageStore.transfer', () => {
  it('moves a counter to a new key id and deletes the old entry', () => {
    const store = require('../src/shared/auth/usageStore');
    store._resetForTests();
    store.start({ flushIntervalSec: 9999 });
    store.increment('key:old');
    store.increment('key:old');
    store.increment('key:old');
    expect(store.getCount('key:old')).toBe(3);

    const merged = store.transfer('key:old', 'key:new');
    expect(merged).toBe(3);
    expect(store.getCount('key:old')).toBe(0);
    expect(store.getCount('key:new')).toBe(3);
    store.stop();
  });

  it('sums into an existing destination counter', () => {
    const store = require('../src/shared/auth/usageStore');
    store._resetForTests();
    store.start({ flushIntervalSec: 9999 });
    store.increment('key:old');
    store.increment('key:old');
    store.increment('key:new');
    const merged = store.transfer('key:old', 'key:new');
    expect(merged).toBe(3);
    expect(store.getCount('key:old')).toBe(0);
    expect(store.getCount('key:new')).toBe(3);
    store.stop();
  });

  it('no-ops when source has no counter', () => {
    const store = require('../src/shared/auth/usageStore');
    store._resetForTests();
    store.start({ flushIntervalSec: 9999 });
    expect(store.transfer('key:nope', 'key:dest')).toBe(0);
    expect(store.getCount('key:dest')).toBe(0);
    store.stop();
  });
});

describe('usageStore', () => {
  it('start() initialises today fresh and persists', () => {
    store.start({ flushIntervalSec: 60 });
    store.increment('key:abc');
    store.increment('key:abc');
    store.increment('anon:deadbeef00000000');
    store.flush();

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'usage.json'), 'utf-8'));
    expect(onDisk.date).toBe(store.todayLocalIsoDate());
    expect(onDisk.counters['key:abc']).toBe(2);
    expect(onDisk.counters['anon:deadbeef00000000']).toBe(1);
  });

  it('increment is in-memory; flush writes once for many ops', () => {
    store.start({ flushIntervalSec: 600 });
    for (let i = 0; i < 100; i++) store.increment('key:hot');
    expect(store.getCount('key:hot')).toBe(100);
    expect(fs.existsSync(path.join(tmpRoot, 'usage.json'))).toBe(true);
    const before = fs.statSync(path.join(tmpRoot, 'usage.json')).mtimeMs;
    store.flush();
    const after = fs.statSync(path.join(tmpRoot, 'usage.json')).mtimeMs;
    expect(after).toBeGreaterThanOrEqual(before);
    const persisted = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'usage.json'), 'utf-8'));
    expect(persisted.counters['key:hot']).toBe(100);
  });

  it('start() with stale on-disk date archives and resets counters', () => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'usage.json'),
      JSON.stringify({
        date: '1999-01-01',
        counters: { 'key:old': 5 },
      })
    );
    store.start({ flushIntervalSec: 60 });
    expect(store.getCount('key:old')).toBe(0);
    expect(store.snapshot().date).toBe(store.todayLocalIsoDate());

    const archive = path.join(__dirname, '..', 'logs', 'usage-1999-01-01.json');
    expect(fs.existsSync(archive)).toBe(true);
    fs.rmSync(archive);
  });

  it('resetForNewDay() clears counters and archives', () => {
    store.start({ flushIntervalSec: 60 });
    store.increment('key:x');
    store.increment('key:x');
    const beforeDate = store.snapshot().date;

    store.resetForNewDay();
    expect(store.getCount('key:x')).toBe(0);

    const archive = path.join(__dirname, '..', 'logs', `usage-${beforeDate}.json`);
    expect(fs.existsSync(archive)).toBe(true);
    fs.rmSync(archive);
  });

  it('snapshot() returns a plain object copy', () => {
    store.start({ flushIntervalSec: 60 });
    store.increment('key:a');
    const snap = store.snapshot();
    expect(snap.counters).toEqual({ 'key:a': 1 });
    snap.counters['key:a'] = 999;
    expect(store.getCount('key:a')).toBe(1);
  });
});
