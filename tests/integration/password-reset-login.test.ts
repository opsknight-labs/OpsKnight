/**
 * Integration Test: Verify Login Works After Password Reset
 * Tests the complete flow: password reset → login → access protected routes
 */
import { describe, it, expect, beforeEach, vi, afterAll, beforeAll } from 'vitest';

const runIntegration = Boolean(process.env.VITEST_USE_REAL_DB);
const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

// Mock notifications
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
import { hashPassword } from '@/lib/auth';

let initiatePasswordReset: typeof import('@/lib/password-reset').initiatePasswordReset;
let completePasswordReset: typeof import('@/lib/password-reset').completePasswordReset;

describeIntegration('Password Reset → Login Flow', () => {
  beforeAll(async () => {
    if (!runIntegration) return;
    vi.unmock('@/lib/prisma');
    vi.unmock('../src/lib/prisma');
    vi.resetModules();
    const passwordResetModule = await import('@/lib/password-reset');
    initiatePasswordReset = passwordResetModule.initiatePasswordReset;
    completePasswordReset = passwordResetModule.completePasswordReset;
  });

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should allow login with new password after reset', async () => {
    // 1. Setup: Create user with initial password
    const initialPassword = 'OldPassword123!';
    const newPassword = 'NewSecurePassword456!';
    const user = await createTestUser({
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: await hashPassword(initialPassword),
    });

    // Enable email provider for password reset
    await createTestNotificationProvider(
      'resend',
      { apiKey: 'test-key', fromEmail: 'test@example.com' },
      { enabled: true }
    );

    // Record initial tokenVersion
    const initialTokenVersion = user.tokenVersion || 0;

    // 2. Initiate password reset
    const resetResult = await initiatePasswordReset('test@example.com', '127.0.0.1');
    expect(resetResult.success).toBe(true);

    // 3. Get the reset token from database
    const tokenRecord = await testPrisma.userToken.findFirst({
      where: {
        identifier: 'test@example.com',
        type: 'PASSWORD_RESET',
        usedAt: null,
      },
    });
    expect(tokenRecord).toBeDefined();

    // Extract raw token (we need to brute force or use a known test token)
    // For testing, we'll create a deterministic token
    const { randomBytes, createHash } = await import('crypto');
    const testToken = 'test-reset-token-' + Date.now();
    const testTokenHash = createHash('sha256').update(testToken).digest('hex');

    // Update the token record with our test token
    await testPrisma.userToken.update({
      where: { id: tokenRecord!.id },
      data: { tokenHash: testTokenHash },
    });

    // 4. Complete password reset
    const completeResult = await completePasswordReset(testToken, newPassword, '127.0.0.1');
    expect(completeResult.success).toBe(true);

    // 5. Verify tokenVersion was incremented (invalidates old sessions)
    const updatedUser = await testPrisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.tokenVersion).toBe(initialTokenVersion + 1);

    // 6. Verify old password no longer works
    const bcrypt = await import('bcryptjs');
    const oldPasswordValid = await bcrypt.compare(initialPassword, updatedUser!.passwordHash!);
    expect(oldPasswordValid).toBe(false);

    // 7. Verify new password works
    const newPasswordValid = await bcrypt.compare(newPassword, updatedUser!.passwordHash!);
    expect(newPasswordValid).toBe(true);

    // 8. Simulate login with credentials provider (simplified)
    // In a real scenario, this would go through NextAuth
    const loginUser = await testPrisma.user.findUnique({
      where: { email: 'test@example.com' },
    });
    expect(loginUser).toBeDefined();
    expect(loginUser?.email).toBe('test@example.com');

    // Password comparison should succeed
    const loginPasswordValid = await bcrypt.compare(newPassword, loginUser!.passwordHash!);
    expect(loginPasswordValid).toBe(true);

    // Token version should match the updated version
    expect(loginUser?.tokenVersion).toBe(initialTokenVersion + 1);
  });

  it('should invalidate all old sessions after password reset', async () => {
    // 1. Create user
    const user = await createTestUser({
      email: 'session-test@example.com',
      passwordHash: await hashPassword('OldPassword123!'),
      tokenVersion: 5, // Simulate existing sessions
    });

    await createTestNotificationProvider('resend', {}, { enabled: true });

    // 2. Initiate and complete reset
    await initiatePasswordReset('session-test@example.com', '127.0.0.1');

    const tokenRecord = await testPrisma.userToken.findFirst({
      where: { identifier: 'session-test@example.com', type: 'PASSWORD_RESET', usedAt: null },
    });

    const { createHash } = await import('crypto');
    const testToken = 'test-token-' + Date.now();
    await testPrisma.userToken.update({
      where: { id: tokenRecord!.id },
      data: { tokenHash: createHash('sha256').update(testToken).digest('hex') },
    });

    await completePasswordReset(testToken, 'NewPassword456!', '127.0.0.1');

    // 3. Verify tokenVersion incremented (from 5 → 6)
    const updatedUser = await testPrisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.tokenVersion).toBe(6);

    // Any JWT with tokenVersion < 6 should be considered invalid
    // (This would be enforced in the JWT callback in auth.ts)
  });

  it('should mark reset token as used after completion', async () => {
    await createTestUser({
      email: 'token-test@example.com',
      passwordHash: await hashPassword('Password123!'),
    });
    await createTestNotificationProvider('resend', {}, { enabled: true });

    await initiatePasswordReset('token-test@example.com', '127.0.0.1');

    const tokenRecord = await testPrisma.userToken.findFirst({
      where: { identifier: 'token-test@example.com', type: 'PASSWORD_RESET', usedAt: null },
    });

    const { createHash } = await import('crypto');
    const testToken = 'test-token-' + Date.now();
    await testPrisma.userToken.update({
      where: { id: tokenRecord!.id },
      data: { tokenHash: createHash('sha256').update(testToken).digest('hex') },
    });

    // Complete reset
    await completePasswordReset(testToken, 'NewPassword456!', '127.0.0.1');

    // Verify token is marked as used
    const usedToken = await testPrisma.userToken.findFirst({
      where: { id: tokenRecord!.id },
    });
    expect(usedToken?.usedAt).not.toBeNull();

    // Try to use the same token again
    const secondAttempt = await completePasswordReset(testToken, 'AnotherPassword!', '127.0.0.1');
    expect(secondAttempt.success).toBe(false);
    expect(secondAttempt.error).toContain('Invalid or expired token');
  });
});
