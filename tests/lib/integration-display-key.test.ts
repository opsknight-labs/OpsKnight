import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptStoredSecret } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { resolveIntegrationKeysForDisplay } from '@/lib/integrations/display-key';

vi.mock('@/lib/encryption', () => ({
  decryptStoredSecret: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const decrypt = vi.mocked(decryptStoredSecret);

describe('resolveIntegrationKeysForDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the plaintext routing key, never the stored ciphertext', async () => {
    decrypt.mockResolvedValueOnce('plain-routing-key');

    const keys = await resolveIntegrationKeysForDisplay([
      { id: 'int_1', key: 'v3:k1:iv:tag:ciphertext' },
    ]);

    expect(decrypt).toHaveBeenCalledWith('v3:k1:iv:tag:ciphertext');
    expect(keys.get('int_1')).toBe('plain-routing-key');
    expect(keys.get('int_1')).not.toMatch(/^v3:/);
  });

  it('maps an undecryptable key to null and logs without leaking the secret', async () => {
    decrypt
      .mockResolvedValueOnce('good-key')
      .mockRejectedValueOnce(new Error('Failed to decrypt token'));

    const keys = await resolveIntegrationKeysForDisplay([
      { id: 'int_ok', key: 'v3:k1:a' },
      { id: 'int_bad', key: 'v3:k9:b' },
    ]);

    expect(keys.get('int_ok')).toBe('good-key');
    expect(keys.get('int_bad')).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = vi.mocked(logger.error).mock.calls[0];
    expect(meta).toEqual({ integrationId: 'int_bad', error: 'Failed to decrypt token' });
    expect(JSON.stringify(meta)).not.toContain('v3:k9:b');
  });

  it('returns an empty map when there are no integrations', async () => {
    const keys = await resolveIntegrationKeysForDisplay([]);
    expect(keys.size).toBe(0);
    expect(decrypt).not.toHaveBeenCalled();
  });
});
