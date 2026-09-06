import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashLegacyV2Tokens, hashTokenV2 } from '@/lib/api-keys';

const token = 'ok_test_example_token_for_secret_hardening';
const v2Payload = `opsknight:api-key:v2:${token}`;

function directHash(secret: string) {
  return createHmac('sha256', secret).update(v2Payload).digest('hex');
}

describe('API-key secret hardening', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses API_KEY_SECRET instead of session JWT key material when configured', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'session-secret-for-tests');
    vi.stubEnv('API_KEY_SECRET', 'independent-api-key-secret-for-tests');

    expect(hashTokenV2(token)).toBe(directHash('independent-api-key-secret-for-tests'));
    expect(hashTokenV2(token)).not.toBe(directHash('session-secret-for-tests'));
  });

  it('retains the pre-hardening NEXTAUTH_SECRET V2 hash as a migration lookup', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'old-session-secret-for-tests');
    vi.stubEnv('API_KEY_SECRET', 'new-api-key-secret-for-tests');

    const legacySessionHash = directHash('old-session-secret-for-tests');
    expect(hashLegacyV2Tokens(token)).toContain(legacySessionHash);
    expect(hashTokenV2(token)).not.toBe(legacySessionHash);
  });

  it('domain-separates the development fallback from the raw session secret', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'development-session-secret');
    vi.stubEnv('API_KEY_SECRET', '');

    const oldDirectHash = directHash('development-session-secret');
    expect(hashTokenV2(token)).not.toBe(oldDirectHash);
    expect(hashLegacyV2Tokens(token)).toContain(oldDirectHash);
  });
});
