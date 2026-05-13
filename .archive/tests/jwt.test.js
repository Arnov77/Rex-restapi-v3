const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpRoot;
let mod;

function loadFresh() {
  delete require.cache[require.resolve('../src/shared/auth/jwt')];
  mod = require('../src/shared/auth/jwt');
  mod._resetForTests();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rex-jwt-'));
  const realDataDir = path.join(__dirname, '..', 'data');
  if (fs.existsSync(realDataDir) && !fs.lstatSync(realDataDir).isSymbolicLink()) {
    fs.renameSync(realDataDir, `${realDataDir}.bak-${process.pid}`);
  }
  if (fs.existsSync(realDataDir)) fs.unlinkSync(realDataDir);
  fs.symlinkSync(tmpRoot, realDataDir, 'dir');
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  loadFresh();
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

describe('jwt helper', () => {
  it('auto-generates a secret to data/jwt-secret.txt when JWT_SECRET unset', () => {
    const token = mod.sign({ sub: 'user-1', username: 'alice' });
    expect(token.split('.')).toHaveLength(3);
    const secretPath = path.join(tmpRoot, 'jwt-secret.txt');
    expect(fs.existsSync(secretPath)).toBe(true);
    expect(fs.readFileSync(secretPath, 'utf-8').trim().length).toBeGreaterThanOrEqual(64);
  });

  it('round-trips signed payload', () => {
    const token = mod.sign({ sub: 'u-42', username: 'bob' });
    const decoded = mod.verify(token);
    expect(decoded.sub).toBe('u-42');
    expect(decoded.username).toBe('bob');
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('rejects tampered tokens', () => {
    const token = mod.sign({ sub: 'u-1' });
    const tampered = token.slice(0, -3) + 'AAA';
    expect(() => mod.verify(tampered)).toThrow();
  });

  it('honours JWT_SECRET env when present', () => {
    process.env.JWT_SECRET = 'a'.repeat(64);
    mod._resetForTests();
    const token = mod.sign({ sub: 'u-1' });

    delete process.env.JWT_SECRET;
    mod._resetForTests();
    expect(() => mod.verify(token)).toThrow();
  });
});
