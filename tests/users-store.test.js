const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpRoot;
let store;

function loadFreshStore() {
  delete require.cache[require.resolve('../src/shared/auth/usersStore')];
  store = require('../src/shared/auth/usersStore');
  store._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-users-'));
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

describe('usersStore', () => {
  it('createUser persists, indexes, and never leaks passwordHash via publicView', () => {
    const created = store.createUser({
      username: 'alice',
      email: 'Alice@Example.com',
      passwordHash: '$2b$10$abc',
      apiKeyId: 'key-1',
    });

    expect(created.username).toBe('alice');
    expect(created.email).toBe('alice@example.com');
    expect(created.passwordHash).toBeUndefined();

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'users.json'), 'utf-8'));
    expect(onDisk.users).toHaveLength(1);
    expect(onDisk.users[0].passwordHash).toBe('$2b$10$abc');

    expect(store.findByEmail('alice@example.com')).toBeTruthy();
    expect(store.findByEmail('ALICE@EXAMPLE.COM')).toBeTruthy();
    expect(store.findByUsername('alice')).toBeTruthy();
    expect(store.findByEmailOrUsername('alice')).toBeTruthy();
    expect(store.findByApiKeyId('key-1')).toBeTruthy();
    expect(store.findByApiKeyId('does-not-exist')).toBeNull();
  });

  it('createUser rejects duplicate email + username', () => {
    store.createUser({ username: 'alice', email: 'a@x.com', passwordHash: 'x', apiKeyId: 'k1' });

    expect(() =>
      store.createUser({ username: 'bob', email: 'a@x.com', passwordHash: 'x', apiKeyId: 'k2' })
    ).toThrow(/Email/);

    expect(() =>
      store.createUser({ username: 'alice', email: 'b@x.com', passwordHash: 'x', apiKeyId: 'k3' })
    ).toThrow(/Username/);
  });

  it('updateApiKeyId rebuilds the apiKeyId index', () => {
    const u = store.createUser({
      username: 'alice',
      email: 'a@x.com',
      passwordHash: 'x',
      apiKeyId: 'old',
    });
    store.updateApiKeyId(u.id, 'new');
    expect(store.findByApiKeyId('old')).toBeNull();
    expect(store.findByApiKeyId('new')?.id).toBe(u.id);
  });

  it('touchLogin sets lastLoginAt', () => {
    const u = store.createUser({
      username: 'alice',
      email: 'a@x.com',
      passwordHash: 'x',
      apiKeyId: 'k',
    });
    expect(u.lastLoginAt).toBeNull();
    const after = store.touchLogin(u.id);
    expect(after.lastLoginAt).toBeTruthy();
  });
});
