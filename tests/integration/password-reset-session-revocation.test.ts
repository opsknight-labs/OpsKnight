import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';

const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

type JwtCallback = (args: {
  token: Record<string, unknown>;
  user?: Record<string, unknown>;
  account?: Record<string, unknown>;
  trigger?: string;
  session?: unknown;
}) => Promise<Record<string, unknown>>;

type SessionCallback = (args: {
  session: { user?: Record<string, unknown> };
  token: Record<string, unknown>;
}) => Promise<{ user?: Record<string, unknown> }>;

let issuePasswordResetToken: typeof import('@/lib/password-reset').issuePasswordResetToken;
let completePasswordReset: typeof import('@/lib/password-reset').completePasswordReset;

describeIntegration('Password reset session revocation', () => {
  beforeEach(async () => {
    vi.unmock('@/lib/prisma');
    vi.resetModules();
    await resetDatabase();
    resetAuthOptionsCache();
    ({ issuePasswordResetToken, completePasswordReset } = await import('@/lib/password-reset'));
  });

  it('rejects the same JWT on its next session evaluation after tokenVersion changes', async () => {
    const oldPassword = 'Initial secure passphrase 2026';
    const newPassword = 'Replacement secure phrase 2026';
    const user = await createTestUser({
      email: 'stale-session@example.com',
      name: 'Stale Session User',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(oldPassword, 12),
    });

    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as JwtCallback;
    const session = authOptions.callbacks?.session as unknown as SessionCallback;
    expect(jwt).toBeTypeOf('function');
    expect(session).toBeTypeOf('function');

    const issuedSessionToken = await jwt({
      token: {},
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      account: { provider: 'credentials' },
    });
    expect(issuedSessionToken.sub).toBe(user.id);

    // Pretend the old implementation refreshed this JWT one millisecond ago.
    // Immediate revocation must ignore that cache timestamp.
    issuedSessionToken.userFetchedAt = Date.now();

    const reset = await issuePasswordResetToken({ userId: user.id, email: user.email });
    const completed = await completePasswordReset(reset.token, newPassword, '127.0.0.7');
    expect(completed.success).toBe(true);

    const staleAfterReset = await jwt({ token: issuedSessionToken });
    expect(staleAfterReset.sub).toBeUndefined();
    expect(staleAfterReset.error).toBe('SESSION_REVOKED');

    const sessionAfterReset = await session({
      session: { user: { email: user.email } },
      token: staleAfterReset,
    });
    expect(sessionAfterReset.user).toBeUndefined();

    const updated = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.tokenVersion).toBe((user.tokenVersion ?? 0) + 1);
    expect(await bcrypt.compare(oldPassword, updated!.passwordHash!)).toBe(false);
    expect(await bcrypt.compare(newPassword, updated!.passwordHash!)).toBe(true);
  });
});
