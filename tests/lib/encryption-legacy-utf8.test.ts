import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptWithKey } from '@/lib/encryption';

const KEY = 'ab'.repeat(32);

function legacyCiphertext(plaintext: Buffer | string) {
  const iv = Buffer.alloc(16, 7);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY, 'hex'), iv);
  const payload = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${iv.toString('hex')}:${payload.toString('hex')}`;
}

describe('legacy encryption UTF-8 compatibility', () => {
  it('preserves valid historic Unicode and control characters', async () => {
    const plaintext = 'historic-\uFFFD-value\u0001';
    await expect(decryptWithKey(legacyCiphertext(plaintext), KEY)).resolves.toBe(plaintext);
  });

  it('rejects decrypted bytes that are not valid UTF-8', async () => {
    await expect(decryptWithKey(legacyCiphertext(Buffer.from([0xff, 0xfe])), KEY)).rejects.toThrow();
  });
});
