import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digestMcpSecret } from '@/lib/mcp/auth/config';
import { e2eDigest } from '../helpers/mcp-e2e-digest';

afterEach(() => vi.unstubAllEnvs());

describe('the end-to-end credential digest', () => {
  it('equals the server digest, so specs that mint credentials stay valid', () => {
    const key = randomBytes(32).toString('hex');
    vi.stubEnv('ENCRYPTION_KEY', key);
    for (const value of [randomBytes(32).toString('base64url'), 'x', 'a'.repeat(300)])
      expect(e2eDigest(value, key), value.slice(0, 8)).toBe(digestMcpSecret(value));
  });

  it('depends on the key and on the value', () => {
    const one = randomBytes(32).toString('hex');
    const two = randomBytes(32).toString('hex');
    expect(e2eDigest('same', one)).not.toBe(e2eDigest('same', two));
    expect(e2eDigest('a', one)).not.toBe(e2eDigest('b', one));
  });

  it('refuses to run without a key rather than minting unusable credentials', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => e2eDigest('value')).toThrow(/ENCRYPTION_KEY/);
  });
});
