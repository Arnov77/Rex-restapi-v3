import { describe, expect, it } from 'vitest';
import {
  decryptApiKey,
  encryptApiKey,
  generatePlaintextKey,
  hashApiKey,
  KEY_PREFIX,
} from '../src/modules/apiKeys/apiKeys.crypto.js';

// Provide a deterministic env so loadEnv() inside the crypto module works.
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-1234';
process.env.API_KEY_ENC_KEY ??= '0'.repeat(64);
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role';

describe('apiKeys.crypto', () => {
  it('generates keys with the rex_ prefix', () => {
    const key = generatePlaintextKey();
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(key.length).toBeGreaterThan(KEY_PREFIX.length + 32);
  });

  it('hash is deterministic and 64 hex chars', () => {
    const h1 = hashApiKey('rex_abc');
    const h2 = hashApiKey('rex_abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encrypt then decrypt roundtrips', () => {
    const plain = generatePlaintextKey();
    const enc = encryptApiKey(plain);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptApiKey(enc)).toBe(plain);
  });

  it('detects tampering via GCM auth tag', () => {
    const plain = generatePlaintextKey();
    const enc = encryptApiKey(plain);
    const [iv, tag, ct] = enc.split(':');
    const tampered = `${iv}:${tag}:${ct!.replace(/.$/, (c) => (c === '0' ? '1' : '0'))}`;
    expect(() => decryptApiKey(tampered)).toThrow();
  });
});
