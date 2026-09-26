import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';
import {
  cleanupExpiredSessions,
  ensureRegisteredSession,
  listRegisteredSessions,
  promoteRegisteredSessionPolicy,
  revokeAllRegisteredSessions,
  revokeRegisteredSession,
  touchSessionActivity,
} from '@/lib/session-registry';
import { resolveStreamAuthorization } from '@/lib/realtime-stream-authorization';

vi.unmock('@/lib/prisma');

const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

function makeJti(prefix = 'pg-jti'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

describeIntegration('Session Registry — PostgreSQL Integration Contracts', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // ── 1. Concurrent Registration ──────────────────────────────────────────────
  it('handles concurrent registration race conditions against PostgreSQL unique constraints', async () => {
    const user = await createTestUser({
      email: 'concurrent-reg@example.com',
      name: 'Concurrent Reg User',
    });
    const jti = makeJti('race');

    // Fire 5 concurrent ensureRegisteredSession calls for the exact same session identity
    const results = await Promise.all([
      ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' }),
    ]);

    // All callers receive 'allowed'
    expect(results).toEqual(['allowed', 'allowed', 'allowed', 'allowed', 'allowed']);

    // PostgreSQL holds exactly one row for this (userId, deviceId)
    const rows = await testPrisma.userDevice.findMany({
      where: { userId: user.id, deviceId: `session:${jti}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('session:STANDARD');
  });

  // ── 2. Revoke vs Touch Race ─────────────────────────────────────────────────
  it('guarantees REVOKED platform state wins against concurrent activity touches in PostgreSQL', async () => {
    const user = await createTestUser({
      email: 'revoke-touch@example.com',
      name: 'Revoke Touch User',
    });
    const jti = makeJti('rev-touch');

    await ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' });

    // Race activity touch (throttle=0 to force DB write) with revocation
    await Promise.all([
      touchSessionActivity({ userId: user.id, sessionId: jti, throttleMs: 0 }),
      revokeRegisteredSession({ userId: user.id, sessionId: jti }),
      touchSessionActivity({ userId: user.id, sessionId: jti, throttleMs: 0 }),
    ]);

    // Verify row is firmly revoked in PostgreSQL
    const row = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId: `session:${jti}` } },
    });
    expect(row).not.toBeNull();
    expect(row!.platform).toBe('session:REVOKED:STANDARD');

    // Subsequent access is denied
    const check = await ensureRegisteredSession({
      userId: user.id,
      sessionId: jti,
      policy: 'STANDARD',
    });
    expect(check).toBe('denied');
  });

  // ── 3. Revoke vs Policy Promotion ───────────────────────────────────────────
  it('prevents policy promotion on a revoked session in PostgreSQL', async () => {
    const user = await createTestUser({
      email: 'revoke-promote@example.com',
      name: 'Revoke Promote User',
    });
    const jti = makeJti('pwa-race');

    await ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' });
    const { revoked } = await revokeRegisteredSession({ userId: user.id, sessionId: jti });
    expect(revoked).toBe(true);

    // Promotion must fail
    const promoted = await promoteRegisteredSessionPolicy({
      userId: user.id,
      sessionId: jti,
      policy: 'TRUSTED_PWA',
    });
    expect(promoted).toBe(false);

    // State remains revoked
    const row = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId: `session:${jti}` } },
    });
    expect(row!.platform).toBe('session:REVOKED:STANDARD');
  });

  // ── 4. Deterministic Keyset Cursor Pagination ───────────────────────────────
  it('executes deterministic composite keyset pagination correctly against PostgreSQL', async () => {
    const user = await createTestUser({
      email: 'keyset-pg@example.com',
      name: 'Keyset PG User',
    });
    const TOTAL_SESSIONS = 25;
    const baseTime = Date.now();

    // Create 25 sessions with distinct timestamps in PostgreSQL
    for (let i = 0; i < TOTAL_SESSIONS; i++) {
      const jti = `pg-page-${String(i).padStart(3, '0')}`;
      const digest = createHash('sha256').update(jti).digest('hex');
      await testPrisma.userDevice.create({
        data: {
          userId: user.id,
          deviceId: `session:${jti}`,
          token: JSON.stringify({ v: 2, digest, expiresAt: null }),
          platform: 'session:STANDARD',
          createdAt: new Date(baseTime - i * 10_000),
          lastUsed: new Date(baseTime - i * 5_000),
        },
      });
    }

    // Page 1 (limit: 15)
    const page1 = await listRegisteredSessions(user.id, null, null, 15);
    expect(page1.sessions).toHaveLength(15);
    expect(page1.nextCursor).not.toBeNull();

    // Zero Raw JTI Leakage verification: cursor contains opaque id (CUID), not raw JTI or deviceId
    const decodedCursor = JSON.parse(Buffer.from(page1.nextCursor!, 'base64url').toString('utf8'));
    expect(decodedCursor).toHaveProperty('id');
    expect(decodedCursor).not.toHaveProperty('deviceId');
    expect(page1.nextCursor).not.toContain('session:');
    expect(page1.nextCursor).not.toContain('pg-page-');

    // Page 2 (limit: 15)
    const page2 = await listRegisteredSessions(user.id, null, page1.nextCursor, 15);
    expect(page2.sessions).toHaveLength(10);
    expect(page2.nextCursor).toBeNull();

    // Verify all 25 rows returned with 0 duplicates
    const allIds = [...page1.sessions.map(s => s.id), ...page2.sessions.map(s => s.id)];
    expect(new Set(allIds).size).toBe(TOTAL_SESSIONS);
    expect(allIds).toHaveLength(TOTAL_SESSIONS);
  });

  // ── 5. Cross-user Revocation Authorization ─────────────────────────────────
  it('enforces tenant boundary: User B cannot revoke User A session in PostgreSQL', async () => {
    const userA = await createTestUser({ email: 'usera@example.com', name: 'User A' });
    const userB = await createTestUser({ email: 'userb@example.com', name: 'User B' });
    const jtiA = makeJti('victim');

    await ensureRegisteredSession({ userId: userA.id, sessionId: jtiA, policy: 'STANDARD' });

    const rowA = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: userA.id, deviceId: `session:${jtiA}` } },
    });
    expect(rowA).not.toBeNull();

    // User B attempts to revoke User A's session using its public ID
    const attempt = await revokeRegisteredSession({
      userId: userB.id,
      sessionId: rowA!.id,
    });
    expect(attempt.revoked).toBe(false);

    // User A session is unaffected
    const checkA = await ensureRegisteredSession({
      userId: userA.id,
      sessionId: jtiA,
      policy: 'STANDARD',
    });
    expect(checkA).toBe('allowed');
  });

  // ── 6. Current-session Detection ───────────────────────────────────────────
  it('correctly detects isCurrent when revoking via opaque public CUID handle', async () => {
    const user = await createTestUser({ email: 'current-check@example.com', name: 'Current User' });
    const currentJti = makeJti('current');
    const otherJti = makeJti('other');

    await ensureRegisteredSession({ userId: user.id, sessionId: currentJti, policy: 'STANDARD' });
    await ensureRegisteredSession({ userId: user.id, sessionId: otherJti, policy: 'STANDARD' });

    const currentRow = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId: `session:${currentJti}` } },
    });
    const otherRow = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId: `session:${otherJti}` } },
    });

    // Revoking current session with currentJti passed returns isCurrent: true
    const resCurrent = await revokeRegisteredSession({
      userId: user.id,
      sessionId: currentRow!.id,
      currentJti,
    });
    expect(resCurrent.revoked).toBe(true);
    expect(resCurrent.isCurrent).toBe(true);

    // Revoking other session with currentJti passed returns isCurrent: false
    const resOther = await revokeRegisteredSession({
      userId: user.id,
      sessionId: otherRow!.id,
      currentJti,
    });
    expect(resOther.revoked).toBe(true);
    expect(resOther.isCurrent).toBe(false);
  });

  // ── 7. Revoke All Sessions Transaction ─────────────────────────────────────
  it('atomically revokes all sessions across multiple policies in PostgreSQL', async () => {
    const user = await createTestUser({ email: 'revoke-all-pg@example.com', name: 'Revoke All' });
    const jti1 = makeJti('standard');
    const jti2 = makeJti('pwa');

    await ensureRegisteredSession({ userId: user.id, sessionId: jti1, policy: 'STANDARD' });
    await ensureRegisteredSession({ userId: user.id, sessionId: jti2, policy: 'STANDARD' });
    await promoteRegisteredSessionPolicy({
      userId: user.id,
      sessionId: jti2,
      policy: 'TRUSTED_PWA',
    });

    const revokedCount = await revokeAllRegisteredSessions(user.id);
    expect(revokedCount).toBe(2);

    expect(
      await ensureRegisteredSession({ userId: user.id, sessionId: jti1, policy: 'STANDARD' })
    ).toBe('denied');
    expect(
      await ensureRegisteredSession({ userId: user.id, sessionId: jti2, policy: 'TRUSTED_PWA' })
    ).toBe('denied');
  });

  // ── 8. Cleanup & Resurrection Prevention Contract ──────────────────────────
  it('preserves revoked tombstones during token lifetime to prevent resurrection, then deletes after expiry', async () => {
    const user = await createTestUser({ email: 'resurrect@example.com', name: 'Resurrect Test' });
    const jti = makeJti('pwa-resurrect');

    // Token valid for 60 days
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60;

    await ensureRegisteredSession({
      userId: user.id,
      sessionId: jti,
      policy: 'STANDARD',
      expiresAtSeconds,
    });

    // Revoke session
    const { revoked } = await revokeRegisteredSession({ userId: user.id, sessionId: jti });
    expect(revoked).toBe(true);

    // Simulate cleanup run 35 days later: token is still valid for 25 days
    const day35 = Date.now() + 35 * 24 * 60 * 60 * 1000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(day35);

    // Cleanup must NOT delete the tombstone
    const cleaned35 = await cleanupExpiredSessions(user.id);
    expect(cleaned35).toBe(0);

    // Token presented at Day 35 must still be DENIED (not resurrected)
    const checkDay35 = await ensureRegisteredSession({
      userId: user.id,
      sessionId: jti,
      policy: 'STANDARD',
      expiresAtSeconds,
    });
    expect(checkDay35).toBe('denied');

    // Simulate cleanup run 62 days later: token expired 2 days ago (> 24h buffer)
    const day62 = Date.now() + 62 * 24 * 60 * 60 * 1000;
    dateSpy.mockReturnValue(day62);

    // Tombstone can now safely be cleaned up
    const cleaned62 = await cleanupExpiredSessions(user.id);
    expect(cleaned62).toBe(1);

    // Tombstone is gone from PostgreSQL
    const tombstone = await testPrisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId: `session:${jti}` } },
    });
    expect(tombstone).toBeNull();

    dateSpy.mockRestore();
  });

  // ── 9. Stream Authorization Termination Upon Revocation ─────────────────────
  it('terminates stream authorization immediately upon session revocation', async () => {
    const user = await createTestUser({
      email: 'stream-revoke@example.com',
      name: 'Stream Revoke',
    });
    const jti = makeJti('stream');

    await ensureRegisteredSession({ userId: user.id, sessionId: jti, policy: 'STANDARD' });

    // Active session yields stream authorization
    const auth1 = await resolveStreamAuthorization(user.id, user.tokenVersion ?? 0, jti);
    expect(auth1).not.toBeNull();
    expect(auth1?.sessionJti).toBe(jti);

    // Revoke session
    await revokeRegisteredSession({ userId: user.id, sessionId: jti });

    // Stream authorization immediately returns null (fail-closed, severs connection)
    const auth2 = await resolveStreamAuthorization(user.id, user.tokenVersion ?? 0, jti);
    expect(auth2).toBeNull();
  });

  // ── 10. Stream Authorization Rejection Upon Expiry ──────────────────────────
  it('rejects stream authorization when session expires in PostgreSQL', async () => {
    const user = await createTestUser({
      email: 'stream-expiry@example.com',
      name: 'Stream Expiry User',
    });
    const jti = makeJti('stream-exp');

    // Create session that expired 5 seconds ago
    const expiredSeconds = Math.floor(Date.now() / 1000) - 5;
    const digest = createHash('sha256').update(jti).digest('hex');
    await testPrisma.userDevice.create({
      data: {
        userId: user.id,
        deviceId: `session:${jti}`,
        token: JSON.stringify({
          v: 2,
          digest,
          expiresAt: new Date(expiredSeconds * 1000).toISOString(),
        }),
        platform: 'session:STANDARD',
        createdAt: new Date(Date.now() - 60_000),
        lastUsed: new Date(),
      },
    });

    // Stream authorization rejects expired session immediately
    const auth = await resolveStreamAuthorization(user.id, user.tokenVersion ?? 0, jti);
    expect(auth).toBeNull();
  });
});
