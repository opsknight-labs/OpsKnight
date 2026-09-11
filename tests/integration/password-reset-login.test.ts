/** Integration: password reset -> session revocation -> login credential validity. */
import { describe, it, expect, beforeEach, vi, afterAll, beforeAll } from 'vitest';

const runIntegration = Boolean(process.env.VITEST_USE_REAL_DB);
const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/sms', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }));

import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestNotificationProvider,
} from '../helpers/test-db';
import { hashPassword } from '@/lib/auth';

let initiatePasswordReset: typeof import('@/lib/password-reset').initiatePasswordReset;
let completePasswordReset: typeof import('@/lib/password-reset').completePasswordReset;

describeIntegration('Password Reset -> Login Flow', () => {
  beforeAll(async () => {
    if (!runIntegration) return;
    vi.unmock('@/lib/prisma');
    vi.unmock('../src/lib/prisma');
    vi.resetModules();
    ({ initiatePasswordReset, completePasswordReset } = await import('@/lib/password-reset'));
  });

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  async function installDeterministicToken(userId: string) {
    const tokenRecord = await testPrisma.userToken.findFirst({
      where: { userId, type: 'PASSWORD_RESET', usedAt: null },
    });
    expect(tokenRecord).toBeDefined();
    const { createHash } = await import('crypto');
    const token = `test-reset-token-${Date.now()}-${Math.random()}`;
    await testPrisma.userToken.update({
      where: { id: tokenRecord!.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    return { token, tokenRecord: tokenRecord! };
  }

  it('allows the new password and revokes all older sessions', async () => {
    const initialPassword = 'OldPassword123!';
    const newPassword = 'NewSecurePassword456!';
    const user = await createTestUser({
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: await hashPassword(initialPassword),
    });
    await createTestNotificationProvider(
      'resend',
      { apiKey: 'test-key', fromEmail: 'test@example.com' },
      { enabled: true }
    );

    const initialTokenVersion = user.tokenVersion || 0;
    await initiatePasswordReset(user.email, '127.0.0.1');
    const { token } = await installDeterministicToken(user.id);
    expect((await completePasswordReset(token, newPassword, '127.0.0.1')).success).toBe(true);

    const updatedUser = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.tokenVersion).toBe(initialTokenVersion + 1);

    const bcrypt = await import('bcryptjs');
    expect(await bcrypt.compare(initialPassword, updatedUser!.passwordHash!)).toBe(false);
    expect(await bcrypt.compare(newPassword, updatedUser!.passwordHash!)).toBe(true);
    expect(
      await testPrisma.auditLog.findFirst({ where: { action: 'auth.password_reset.completed' } })
    ).toBeDefined();
  });

  it('atomically prevents reset-token reuse', async () => {
    const user = await createTestUser({
      email: 'token-test@example.com',
      passwordHash: await hashPassword('Password123!'),
    });
    await createTestNotificationProvider('resend', {}, { enabled: true });
    await initiatePasswordReset(user.email, '127.0.0.1');
    const { token, tokenRecord } = await installDeterministicToken(user.id);

    expect((await completePasswordReset(token, 'NewPassword456!', '127.0.0.1')).success).toBe(true);
    expect((await testPrisma.userToken.findUnique({ where: { id: tokenRecord.id } }))?.usedAt).not.toBeNull();

    const second = await completePasswordReset(token, 'AnotherPassword!', '127.0.0.1');
    expect(second.success).toBe(false);
    expect(second.code).toBe('INVALID_TOKEN');
  });

  it('allows only one concurrent submit for the same token', async () => {
    const user = await createTestUser({
      email: 'race@example.com',
      passwordHash: await hashPassword('Password123!'),
    });
    await createTestNotificationProvider('resend', {}, { enabled: true });
    await initiatePasswordReset(user.email, '127.0.0.1');
    const { token } = await installDeterministicToken(user.id);

    const results = await Promise.all([
      completePasswordReset(token, 'ConcurrentPasswordOne!', '127.0.0.2'),
      completePasswordReset(token, 'ConcurrentPasswordTwo!', '127.0.0.3'),
    ]);
    expect(results.filter(result => result.success)).toHaveLength(1);
  });
});
