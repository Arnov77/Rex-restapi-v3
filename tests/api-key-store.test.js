const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpRoot;
let store;

function loadFreshStore() {
  delete require.cache[require.resolve('../src/shared/auth/apiKeyStore')];
  store = require('../src/shared/auth/apiKeyStore');
  store._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-keys-'));
  // Redirect the store's data/ dir into the tmp tree by symlinking.
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  loadFreshStore();
});

afterEach(() => {
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.unlinkSync(realDataDir);
  }
  const backup = path.join(__dirname, '..', `data.bak-${process.pid}`);
  if (fs.existsSync(backup)) fs.renameSync(backup, realDataDir);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('apiKeyStore', () => {
  it('createKey returns plaintext, persists hash + plaintext, and listKeys/getPlaintextById expose the right view', () => {
    const { plaintext, record } = store.createKey({ name: 'test', tier: 'user' });
    expect(plaintext).toMatch(/^rex_/);
    expect(record.name).toBe('test');
    expect(record.tier).toBe('user');
    expect(record.keyHash).toBeUndefined();
    expect(record.key).toBeUndefined();

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'api-keys.json'), 'utf-8'));
    expect(onDisk.keys).toHaveLength(1);
    expect(onDisk.keys[0].keyHash).toBeDefined();
    expect(onDisk.keys[0].keyHash).not.toBe(plaintext);
    expect(onDisk.keys[0].key).toBe(plaintext);

    expect(store.getPlaintextById(record.id)).toBe(plaintext);
    expect(store.getPlaintextById('does-not-exist')).toBeNull();

    for (const entry of store.listKeys()) {
      expect(entry.keyHash).toBeUndefined();
      expect(entry.key).toBeUndefined();
    }
  });

  it('verifyKey accepts the plaintext, rejects revoked + unknown', () => {
    const { plaintext, record } = store.createKey({ name: 'a', tier: 'user' });
    expect(store.verifyKey(plaintext)).toMatchObject({ id: record.id, tier: 'user' });
    expect(store.verifyKey('rex_unknown')).toBeNull();
    expect(store.verifyKey('not-a-real-prefix')).toBeNull();

    store.revokeKey(record.id);
    expect(store.verifyKey(plaintext)).toBeNull();
  });

  it('createKey rejects invalid tier', () => {
    expect(() => store.createKey({ name: 'x', tier: 'godmode' })).toThrow();
  });

  it('listKeys never leaks the hash', () => {
    store.createKey({ name: 'a', tier: 'user' });
    store.createKey({ name: 'b', tier: 'master' });
    const listed = store.listKeys();
    expect(listed).toHaveLength(2);
    for (const entry of listed) expect(entry.keyHash).toBeUndefined();
  });

  it('ensureMasterKey creates one when none exists and writes notice file', () => {
    delete process.env.MASTER_API_KEY;
    store.ensureMasterKey();
    const noticePath = path.join(tmpRoot, 'master-key.txt');
    expect(fs.existsSync(noticePath)).toBe(true);
    const plaintext = fs.readFileSync(noticePath, 'utf-8').trim();
    expect(plaintext).toMatch(/^rex_/);
    const verified = store.verifyKey(plaintext);
    expect(verified?.tier).toBe('master');
  });

  it('ensureMasterKey honours MASTER_API_KEY env when set', () => {
    const { plaintext } = store.createKey({ name: 'preset', tier: 'user' });
    process.env.MASTER_API_KEY = plaintext;
    store.ensureMasterKey();
    delete process.env.MASTER_API_KEY;

    const verified = store.verifyKey(plaintext);
    expect(verified?.tier).toBe('master');
  });
});
