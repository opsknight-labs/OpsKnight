/**
 * Integration Tests for Forgot Password Flow (REAL DB)
 */
import { describe, it, expect, beforeEach, vi, afterAll, beforeAll } from 'vitest';

const runIntegration = Boolean(process.env.VITEST_USE_REAL_DB);
const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

// Mocks - Use aliases to match source code imports exactly
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/sms', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}));

import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestNotificationProvider,
} from '../helpers/test-db';

let initiatePasswordReset: typeof import('@/lib/password-reset').initiatePasswordReset;

describeIntegration('Forgot Password Integration', () => {
  beforeAll(async () => {
    if (!runIntegration) return;
    vi.unmock('@/lib/prisma');
    vi.unmock('../src/lib/prisma');
    vi.resetModules();
    ({ initiatePasswordReset } = await import('@/lib/password-reset'));
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should send EMAIL when email provider is enabled', async () => {
    // 1. Setup User and Provider
    const _user = await createTestUser({ email: 'user@example.com' });
    await createTestNotificationProvider(
      'resend',
      { apiKey: 'test-key', fromEmail: 'test@example.com' },
      { enabled: true }
    );

    // 2. Initiate Reset
    const result = await initiatePasswordReset('user@example.com', '127.0.0.1');

    // 3. Verify Result
    expect(result.success).toBe(true);
    expect(result.message).toContain('receive password reset instructions');

    // 4. Verify DB Token
    const token = await testPrisma.userToken.findFirst({
      where: { identifier: 'user@example.com', type: 'PASSWORD_RESET', usedAt: null },
    });
    expect(token).toBeDefined();

    // 5. Verify Audit Log
    const log = await testPrisma.auditLog.findFirst({
      where: {
        action: 'PASSWORD_RESET_INITIATED',
        details: { path: ['targetEmail'], equals: 'user@example.com' },
      },
    });
    expect(log).toBeDefined();

    // 6. Verify Email Sent (Mock)
    const emailModule = await import('@/lib/email');
    expect(emailModule.sendEmail).toHaveBeenCalled();
  });

  it('should fallback to SMS when email fails or disabled', async () => {
    // 1. Setup User (with phone)
    const _user = await createTestUser({
      email: 'smsuser@example.com',
      phoneNumber: '+15555555555',
      smsNotificationsEnabled: true,
    });
    // 2. Setup Providers: Email disabled, SMS enabled
    await createTestNotificationProvider('resend', {}, { enabled: false });
    await createTestNotificationProvider(
      'twilio',
      { accountSid: 'AC...', authToken: '...' },
      { enabled: true }
    );

    // 3. Initiate Reset
    const result = await initiatePasswordReset('smsuser@example.com', '127.0.0.1');

    // 4. Verify Result
    expect(result.success).toBe(true);

    // 5. Verify SMS Sent
    const smsModule = await import('@/lib/sms');
    expect(smsModule.sendSMS).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15555555555',
        message: expect.stringContaining('Reset your password'),
      })
    );
  });

  it('should rate limit requests', async () => {
    const _user = await createTestUser({ email: 'limit@example.com' });
    await createTestNotificationProvider('resend', { enabled: true });

    // Do 5 requests (MAX is 5)
    for (let i = 0; i < 5; i++) {
      await initiatePasswordReset('limit@example.com', '127.0.0.1');
    }

    // Verify we actually logged 5 attempts
    const count = await testPrisma.auditLog.count({
      where: {
        action: 'PASSWORD_RESET_INITIATED',
        details: { path: ['targetEmail'], equals: 'limit@example.com' },
      },
    });
    expect(count).toBe(5);

    // 6th request should fail
    const result = await initiatePasswordReset('limit@example.com', '127.0.0.1');
    expect(result.success).toBe(false);
  }, 10000);

  it('should not reveal non-existent users', async () => {
    const result = await initiatePasswordReset('ghost@example.com', '127.0.0.1');
    expect(result.success).toBe(true);
    expect(result.message).toContain('receive password reset instructions');

    // Ensure no token created
    const token = await testPrisma.userToken.findFirst({
      where: { identifier: 'ghost@example.com', type: 'PASSWORD_RESET' },
    });
    expect(token).toBeNull();
  });
});
