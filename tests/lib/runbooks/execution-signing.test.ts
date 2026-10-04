import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { canonicalEnvelope } from '../../../agent/src/envelope';

const mocks = vi.hoisted(() => ({ find: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { runbookExecutionSigningKey: { findUnique: mocks.find } },
}));
vi.mock('@/lib/encryption', () => ({ decrypt: mocks.decrypt, encrypt: vi.fn() }));
import { signExecutionEnvelope } from '@/lib/runbooks/execution-signing';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('Execution signing cache', () => {
  it('reuses parsed keys and invalidates on ciphertext replacement and encryption-key retirement', async () => {
    const keys = generateKeyPairSync('ed25519');
    const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const row = { id: 'default', publicKey: 'pin', privateKeyEncrypted: 'ciphertext1' };
    mocks.find.mockImplementation(async () => ({ ...row }));
    mocks.decrypt.mockResolvedValue(pem);
    vi.stubEnv('ENCRYPTION_KEYS', 'first');
    const payload = { attemptId: 'test' };
    await signExecutionEnvelope(payload);
    const result = await signExecutionEnvelope(payload);
    expect(mocks.decrypt).toHaveBeenCalledTimes(1);
    expect(
      verify(
        null,
        Buffer.from(canonicalEnvelope(payload)),
        keys.publicKey,
        Buffer.from(result.signature, 'base64')
      )
    ).toBe(true);
    row.privateKeyEncrypted = 'ciphertext2';
    await signExecutionEnvelope(payload);
    expect(mocks.decrypt).toHaveBeenCalledTimes(2);
    vi.stubEnv('ENCRYPTION_KEYS', 'retired');
    mocks.decrypt.mockRejectedValue(new Error('Required encryption key removed'));
    await expect(signExecutionEnvelope(payload)).rejects.toThrow('Required encryption key removed');
    await expect(signExecutionEnvelope(payload)).rejects.toThrow('Required encryption key removed');
  });
});
