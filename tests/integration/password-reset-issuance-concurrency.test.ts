import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

let issuePasswordResetToken: typeof import('@/lib/password-reset').issuePasswordResetToken;

describeIntegration('Password reset issuance concurrency', () => {
  beforeEach(async () => {
    vi.unmock('@/lib/prisma');
    vi.resetModules();
    ({ issuePasswordResetToken } = await import('@/lib/password-reset'));
    await resetDatabase();
  });

  it('leaves exactly one live token after 20 concurrent issuers', async () => {
    const user = await createTestUser({
      email: 'reset-issuance-race@example.com',
      status: 'ACTIVE',
    });

    const issued = await Promise.all(
      Array.from({ length: 20 }, () =>
        issuePasswordResetToken({ userId: user.id, email: user.email })
      )
    );

    expect(new Set(issued.map(value => value.tokenHash)).size).toBe(20);

    const records = await testPrisma.userToken.findMany({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'asc' },
    });
    const live = records.filter(
      record => !record.usedAt && !record.revokedAt && record.expiresAt > new Date()
    );

    expect(records).toHaveLength(20);
    expect(live).toHaveLength(1);
    expect(records.filter(record => record.revokedAt)).toHaveLength(19);
    expect(issued.map(value => value.tokenHash)).toContain(live[0].tokenHash);
  });
});
