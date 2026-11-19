import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { encrypt } from '@/lib/encryption';
import { activeSignatureSecrets } from '@/lib/integrations/auth';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
});

describe('activeSignatureSecrets', () => {
  it('honours the previous secret only during the rotation overlap', async () => {
    const base = {
      signatureSecret: await encrypt('new'),
      previousSignatureSecret: await encrypt('old'),
    };
    expect(
      await activeSignatureSecrets({
        ...base,
        previousSignatureSecretExpiresAt: new Date(Date.now() + 60_000),
      })
    ).toEqual(['new', 'old']);
    expect(
      await activeSignatureSecrets({
        ...base,
        previousSignatureSecretExpiresAt: new Date(Date.now() - 1),
      })
    ).toEqual(['new']);
  });
});
