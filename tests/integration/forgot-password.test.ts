/** Integration tests for password recovery (REAL DB). */
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

let initiatePasswordReset: typeof import('@/lib/password-reset').initiatePasswordReset;
let processCentralNotificationQueue: typeof import('@/lib/notification-control-plane').processCentralNotificationQueue;

describeIntegration('Forgot Password Integration', () => {
  beforeAll(async () => {
    if (!runIntegration) return;
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    vi.unmock('@/lib/prisma');
    vi.unmock('../src/lib/prisma');
    vi.resetModules();
    ({ initiatePasswordReset } = await import('@/lib/password-reset'));
    ({ processCentralNotificationQueue } = await import('@/lib/notification-control-plane'));
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('queues EMAIL without waiting for provider delivery', async () => {
    const user = await createTestUser({ email: 'user@example.com' });
    await createTestNotificationProvider(
      'resend',
      { apiKey: 'test-key', fromEmail: 'test@example.com' },
      { enabled: true }
    );

    const result = await initiatePasswordReset('user@example.com', '127.0.0.1');
    await processCentralNotificationQueue();

    expect(result.success).toBe(true);
    expect(result.message).toContain('If an account exists');
    expect(
      await testPrisma.userToken.findFirst({
        where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
      })
    ).toBeDefined();
    expect(
      await testPrisma.auditLog.findFirst({ where: { action: 'auth.password_reset.requested' } })
    ).toBeDefined();
    expect(
      await testPrisma.notification.findFirst({ where: { templateKey: 'password-reset' } })
    ).toBeDefined();
  });

  it('uses SMS only when email is unavailable', async () => {
    const user = await createTestUser({
      email: 'smsuser@example.com',
      phoneNumber: '+15555555555',
      smsNotificationsEnabled: true,
    });
    await createTestNotificationProvider('resend', {}, { enabled: false });
    await createTestNotificationProvider(
      'twilio',
      { accountSid: 'AC...', authToken: '...' },
      { enabled: true }
    );

    const result = await initiatePasswordReset(user.email, '127.0.0.1');
    await processCentralNotificationQueue();
    expect(result.success).toBe(true);
    expect(
      await testPrisma.notification.findFirst({ where: { templateKey: 'password-reset-sms' } })
    ).toBeDefined();
    expect(
      await testPrisma.notification.findFirst({ where: { templateKey: 'password-reset' } })
    ).toBeNull();
  });

  it('rate limits without changing the public response contract', async () => {
    await createTestUser({ email: 'limit@example.com' });
    await createTestNotificationProvider('resend', { enabled: true });

    for (let i = 0; i < 5; i += 1) {
      expect((await initiatePasswordReset('limit@example.com', '127.0.0.1')).success).toBe(true);
    }
    const sixth = await initiatePasswordReset('limit@example.com', '127.0.0.1');
    expect(sixth.success).toBe(true);
    expect(sixth.message).toContain('If an account exists');
    expect(
      await testPrisma.auditLog.findFirst({ where: { action: 'auth.password_reset.rate_limited' } })
    ).toBeDefined();
  }, 15000);

  it('does not reveal non-existent users or create reset tokens for them', async () => {
    const result = await initiatePasswordReset('ghost@example.com', '127.0.0.1');
    expect(result.success).toBe(true);
    expect(result.message).toContain('If an account exists');
    expect(await testPrisma.userToken.count({ where: { type: 'PASSWORD_RESET' } })).toBe(0);
  });
});
