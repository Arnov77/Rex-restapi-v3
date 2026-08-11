import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../../config/env.js';
import { AppError, Internal } from '@shared/errors.js';

export const KEY_PREFIX = 'rex_';

/** Generate a fresh plaintext API key. Format: `rex_<base64url>`. */
export function generatePlaintextKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** SHA-256 hash for indexing — equality lookup only, never reversed. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * AES-256-GCM encryption so the master key (and only the master key) can
 * be revealed to its owner later. Format: `iv:tag:ciphertext` — all hex.
 */
export function encryptApiKey(plaintext: string): string {
  const env = loadEnv();
  const key = Buffer.from(env.API_KEY_ENC_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptApiKey(payload: string): string {
  const env = loadEnv();
  const key = Buffer.from(env.API_KEY_ENC_KEY, 'hex');
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) throw Internal('Malformed encrypted key payload');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
    return plain.toString('utf8');
  } catch (err) {
    // GCM auth-tag verification failing almost always means this payload
    // was encrypted under a different API_KEY_ENC_KEY than the one
    // currently configured (e.g. the server's .env was regenerated after
    // a migration) — the ciphertext itself is fine, it just can't be
    // opened with today's key. There's no way to recover the old
    // plaintext; the only fix is generating a new key.
    throw new AppError(
      500,
      'KEY_DECRYPTION_FAILED',
      `Failed to decrypt stored API key: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      'This key can no longer be retrieved. Regenerate it to get a new one.',
    );
  }
}
