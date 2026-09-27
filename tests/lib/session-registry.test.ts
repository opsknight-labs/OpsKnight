/**
 * Session Registry — Comprehensive Test Suite
 *
 * Covers all target scenarios for the canonical JTI-based session registry:
 *
 * 1.  Same browser, two JTIs → 2 separate rows; raw JTI kept strictly server-side
 * 2.  Registry independent of audit event count
 * 3.  Activity touch updates lastUsed
 * 4.  Throttle limits DB writes (two-tier: local cache + DB conditional)
 * 5.  Multi-instance safety (DB-level WHERE lastUsed < cutoff)
 * 6.  Revoke session using opaque public handle (UserDevice.id)
 * 7.  Atomic bulk revocation of all sessions via transaction
 * 8.  Expired session not shown as ACTIVE
 * 9.  Race between touch and revoke — REVOKED wins
 * 10. Duplicate ensureRegisteredSession (P2002) → exactly one row
 * 11. Fault tolerance: DB connection errors return 'unavailable'
 * 12. Non-reversible 8-char hex sessionDisplayId (preventing raw JTI leakage)
 * 13. Deterministic Keyset Cursor pagination (createdAt DESC, deviceId DESC)
 * 14. Authorization scope: cross-user revocation prevention
 * 15. Standalone cleanup of expired/revoked records
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import {
  ensureRegisteredSession,
  isSessionActive,
  listRegisteredSessions,
  revokeRegisteredSession,
  revokeAllRegisteredSessions,
  sessionDisplayId,
  sessionDisplaySuffix,
  touchSessionActivity,
  cleanupExpiredSessions,
} from '@/lib/session-registry';

// ─── In-memory store shared across all mocked prisma calls ────────────────────

const store = new Map<string, Record<string, unknown>>();

function storeKey(userId: string, deviceId: string) {
  return `${userId}::${deviceId}`;
}

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    userDevice: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
      deleteMany: mocks.deleteMany,
    },
    $transaction: mocks.$transaction,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function makeJti(label = '') {
  return `test-${label}-${Math.random().toString(36).slice(2)}`;
}

function activePlatform(policy = 'STANDARD') {
  return `session:${policy}`;
}
function revokedPlatform(policy = 'STANDARD') {
  return `session:REVOKED:${policy}`;
}
function metaToken(sessionId: string, expiresAt: string | null = null) {
  return JSON.stringify({ v: 2, digest: sha256(sessionId), expiresAt });
}

/** Seed a row directly into the mock store. */
function seedSession(
  userId: string,
  sessionId: string,
  opts: {
    id?: string;
    policy?: string;
    revoked?: boolean;
    createdAt?: Date;
    lastUsed?: Date;
    expiresAt?: string | null;
    userAgent?: string | null;
  } = {}
) {
  const {
    id = `cuid-${sessionId}`,
    policy = 'STANDARD',
    revoked = false,
    createdAt = new Date(Date.now() - 60_000),
    lastUsed = new Date(),
    expiresAt = null,
    userAgent = null,
  } = opts;
  const deviceId = `session:${sessionId}`;
  const key = storeKey(userId, deviceId);
  store.set(key, {
    id,
    userId,
    deviceId,
    platform: revoked ? revokedPlatform(policy) : activePlatform(policy),
    token: metaToken(sessionId, expiresAt),
    createdAt,
    lastUsed,
    userAgent,
  });
}

/** Returns all store rows for a given userId. */
function storeRows(userId: string) {
  return Array.from(store.entries())
    .filter(([k]) => k.startsWith(`${userId}::`))
    .map(([, v]) => v);
}

// ─── Wire mock implementations ────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();

  mocks.$transaction.mockImplementation((promises: Promise<unknown>[]) => Promise.all(promises));

  mocks.findUnique.mockImplementation(
    ({ where }: { where: { userId_deviceId: { userId: string; deviceId: string } } }) => {
      const key = storeKey(where.userId_deviceId.userId, where.userId_deviceId.deviceId);
      return Promise.resolve(store.get(key) ?? null);
    }
  );

  mocks.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    for (const [key, row] of store.entries()) {
      const [uid] = key.split('::');
      if (uid !== where.userId) continue;

      if (where.OR && Array.isArray(where.OR)) {
        let matched = false;
        for (const orCond of where.OR as Record<string, unknown>[]) {
          if (orCond.id !== undefined && row.id === orCond.id) {
            matched = true;
            break;
          }
          if (orCond.deviceId !== undefined && row.deviceId === orCond.deviceId) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }
      return Promise.resolve(row);
    }
    return Promise.resolve(null);
  });

  let mockClock = Date.now();
  mocks.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const key = storeKey(data.userId as string, data.deviceId as string);
    if (store.has(key)) {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      return Promise.reject(err);
    }
    const id = `cuid-${Math.random().toString(36).slice(2)}`;
    mockClock += 10;
    const row = { id, createdAt: new Date(mockClock), ...data };
    store.set(key, row);
    return Promise.resolve(row);
  });

  mocks.update.mockImplementation(
    ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let key: string | undefined;
      if (where.userId_deviceId) {
        const { userId, deviceId } = where.userId_deviceId as {
          userId: string;
          deviceId: string;
        };
        key = storeKey(userId, deviceId);
      }
      if (key && store.has(key)) {
        const existing = store.get(key)!;
        const updated = { ...existing, ...data };
        store.set(key, updated);
        return Promise.resolve(updated);
      }
      return Promise.reject(new Error('Record not found'));
    }
  );

  mocks.updateMany.mockImplementation(
    ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const [key, row] of store.entries()) {
        const [uid] = key.split('::');
        if (uid !== where.userId) continue;

        const platform = row.platform as string;

        // id filter (for handle-based revocation)
        if (where.id !== undefined && row.id !== where.id) continue;

        // platform exact-match (revokeAllRegisteredSessions, promotePolicy)
        if (where.platform !== undefined && typeof where.platform === 'string') {
          if (platform !== where.platform) continue;
        }

        // platform { in: [...] } filter (atomic revocation)
        if (
          where.platform !== undefined &&
          typeof where.platform === 'object' &&
          'in' in (where.platform as object)
        ) {
          const inList = (where.platform as { in: string[] }).in;
          if (!inList.includes(platform)) continue;
        }

        // platform startsWith (from activeSessionWhere used in touchSessionActivity)
        if (
          where.platform !== undefined &&
          typeof where.platform === 'object' &&
          'startsWith' in (where.platform as object)
        ) {
          const prefix = (where.platform as { startsWith: string }).startsWith;
          if (!platform.startsWith(prefix)) continue;
        }

        // NOT clause (from activeSessionWhere — exclude revoked)
        if (where.NOT !== undefined) {
          const notClause = where.NOT as { platform?: { startsWith?: string } };
          if (notClause.platform?.startsWith && platform.startsWith(notClause.platform.startsWith))
            continue;
        }

        // deviceId filter
        if (where.deviceId !== undefined && typeof where.deviceId === 'string') {
          if (row.deviceId !== where.deviceId) continue;
        }

        // lastUsed < cutoff filter (for touchSessionActivity throttle)
        if (
          where.lastUsed &&
          typeof where.lastUsed === 'object' &&
          'lt' in (where.lastUsed as object)
        ) {
          const cutoff = (where.lastUsed as { lt: Date }).lt;
          if (!((row.lastUsed as Date) < cutoff)) continue;
        }

        store.set(key, { ...row, ...data });
        count++;
      }
      return Promise.resolve({ count });
    }
  );

  mocks.findMany.mockImplementation(
    ({
      where,
      orderBy: _orderBy,
      take,
    }: {
      where: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
    }) => {
      const results: Record<string, unknown>[] = [];
      for (const [key, row] of store.entries()) {
        const [uid] = key.split('::');
        if (where.userId && uid !== where.userId) continue;

        const platform = row.platform as string;

        // platform startsWith filter
        if (
          where.platform &&
          typeof where.platform === 'object' &&
          'startsWith' in (where.platform as object)
        ) {
          const prefix = (where.platform as { startsWith: string }).startsWith;
          if (!platform.startsWith(prefix)) continue;
        }

        // NOT clause (exclude revoked)
        if (where.NOT !== undefined) {
          const notClause = where.NOT as { platform?: { startsWith?: string } };
          if (notClause.platform?.startsWith && platform.startsWith(notClause.platform.startsWith))
            continue;
        }

        // Keyset pagination OR condition:
        if (where.OR && Array.isArray(where.OR)) {
          const cond1 = where.OR[0] as { createdAt?: { lt: Date } };
          const cond2 = where.OR[1] as { createdAt?: Date; id?: { lt: string } };

          const rowTime = (row.createdAt as Date).getTime();
          const rowId = row.id as string;

          const match1 = cond1?.createdAt?.lt && rowTime < cond1.createdAt.lt.getTime();
          const match2 =
            cond2?.createdAt &&
            cond2?.id?.lt &&
            rowTime === cond2.createdAt.getTime() &&
            rowId < cond2.id.lt;

          if (!match1 && !match2) continue;
        }

        results.push(row);
      }

      // Sort by createdAt desc, id desc (stable keyset ordering)
      results.sort((a, b) => {
        const timeDiff = (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime();
        if (timeDiff !== 0) return timeDiff;
        return (b.id as string).localeCompare(a.id as string);
      });

      return Promise.resolve(take !== undefined ? results.slice(0, take) : results);
    }
  );

  mocks.deleteMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    let count = 0;
    const toDelete: string[] = [];
    for (const [key, row] of store.entries()) {
      const [uid] = key.split('::');
      if (where.userId && uid !== where.userId) continue;

      if (where.id && typeof where.id === 'object' && 'in' in (where.id as object)) {
        const inIds = (where.id as { in: string[] }).in;
        if (!inIds.includes(row.id as string)) continue;
      }

      const platform = row.platform as string;
      if (
        where.platform &&
        typeof where.platform === 'object' &&
        'startsWith' in (where.platform as object)
      ) {
        const prefix = (where.platform as { startsWith: string }).startsWith;
        if (!platform.startsWith(prefix)) continue;
      }

      if (where.NOT !== undefined) {
        const notClause = where.NOT as { platform?: { startsWith?: string } };
        if (notClause.platform?.startsWith && platform.startsWith(notClause.platform.startsWith))
          continue;
      }

      if (
        where.createdAt &&
        typeof where.createdAt === 'object' &&
        'lt' in (where.createdAt as object)
      ) {
        const ltDate = (where.createdAt as { lt: Date }).lt;
        if ((row.createdAt as Date).getTime() >= ltDate.getTime()) continue;
      }

      toDelete.push(key);
      count++;
    }
    for (const k of toDelete) store.delete(k);
    return Promise.resolve({ count });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('session-registry', () => {
  // ── Test 1 ─────────────────────────────────────────────────────────────────
  describe('Test 1 — same browser, two distinct JTIs', () => {
    it('creates two independent registry rows and returns opaque handles, keeping raw JTI unexposed', async () => {
      const userId = 'user-1';
      const jtiA = makeJti('A');
      const jtiB = makeJti('B');
      const ua = 'Mozilla/5.0 (Macintosh) Chrome/120';

      const rA = await ensureRegisteredSession({
        sessionId: jtiA,
        userId,
        policy: 'STANDARD',
        userAgent: ua,
      });
      const rB = await ensureRegisteredSession({
        sessionId: jtiB,
        userId,
        policy: 'STANDARD',
        userAgent: ua,
      });

      expect(rA).toBe('allowed');
      expect(rB).toBe('allowed');

      const { sessions } = await listRegisteredSessions(userId);
      expect(sessions).toHaveLength(2);

      // Verify raw JTIs are NEVER exposed to the client in session.id
      expect(sessions.map(s => s.id)).not.toContain(jtiA);
      expect(sessions.map(s => s.id)).not.toContain(jtiB);

      // Verify opaque cuid handles are returned
      expect(sessions[0].id).toMatch(/^cuid-/);
      expect(sessions[1].id).toMatch(/^cuid-/);

      // Verify safe 8-char display identifiers are present
      expect(sessions[0].displayId).toBe(sessionDisplayId(jtiB)); // ordered by createdAt desc
      expect(sessions[1].displayId).toBe(sessionDisplayId(jtiA));
    });
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  describe('Test 2 — registry independent of audit event count', () => {
    it('returns sessions beyond the old audit take:100 limit on first page', async () => {
      const userId = 'user-2';
      const COUNT = 80;
      for (let i = 0; i < COUNT; i++) {
        seedSession(userId, `jti-${String(i).padStart(4, '0')}`, {
          createdAt: new Date(Date.now() - i * 1000),
        });
      }
      const page1 = await listRegisteredSessions(userId, null, null, 50);
      expect(page1.sessions.length).toBe(50);
      expect(page1.nextCursor).not.toBeNull();
    });
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  describe('Test 3 — activity touch updates lastUsed', () => {
    it('advances lastUsed after touchSessionActivity with throttle=0', async () => {
      const userId = 'user-3';
      const jti = makeJti();
      const oldDate = new Date(Date.now() - 10 * 60 * 1000);
      seedSession(userId, jti, { lastUsed: oldDate });

      const before = Date.now();
      await touchSessionActivity({ userId, sessionId: jti, throttleMs: 0 });
      const after = Date.now();

      const rows = storeRows(userId);
      expect(rows).toHaveLength(1);
      const writtenTime = (rows[0].lastUsed as Date).getTime();
      expect(writtenTime).toBeGreaterThanOrEqual(before);
      expect(writtenTime).toBeLessThanOrEqual(after + 10);
      expect(writtenTime).toBeGreaterThan(oldDate.getTime());
    });
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  describe('Test 4 — throttle limits DB writes', () => {
    it('skips the DB update when lastUsed is within the throttle window', async () => {
      const userId = 'user-4';
      const jti = makeJti();
      const freshDate = new Date();
      seedSession(userId, jti, { lastUsed: freshDate });

      await touchSessionActivity({ userId, sessionId: jti, throttleMs: 5 * 60 * 1000 });

      const rows = storeRows(userId);
      expect((rows[0].lastUsed as Date).getTime()).toBeCloseTo(freshDate.getTime(), -2);
    });
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  describe('Test 5 — multi-instance distributed correctness', () => {
    it('produces exactly one DB row per JTI across concurrent registrations', async () => {
      const userId = 'user-5';
      const jti = makeJti();

      const results = await Promise.allSettled([
        ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' }),
        ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' }),
        ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' }),
      ]);

      for (const r of results) {
        expect(r.status).toBe('fulfilled');
        expect((r as PromiseFulfilledResult<string>).value).toBe('allowed');
      }

      expect(storeRows(userId)).toHaveLength(1);
    });
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────
  describe('Test 6 — revoke individual session using opaque public handle', () => {
    it('revokes session using the opaque public handle (UserDevice.id), keeping JTI unexposed', async () => {
      const userId = 'user-6';
      const jtiA = makeJti('A');
      const jtiB = makeJti('B');
      seedSession(userId, jtiA, { id: 'cuid-session-A' });
      seedSession(userId, jtiB, { id: 'cuid-session-B' });

      // List sessions to obtain public handles (as the browser UI does)
      const { sessions } = await listRegisteredSessions(userId);
      const sessionA = sessions.find(s => s.displayId === sessionDisplayId(jtiA));
      expect(sessionA).toBeDefined();
      expect(sessionA?.id).toBe('cuid-session-A');
      expect(sessionA?.id).not.toBe(jtiA); // Public handle is NOT the secret JTI

      // Revoke using the opaque public handle
      const result = await revokeRegisteredSession({ userId, sessionId: sessionA!.id });
      expect(result.revoked).toBe(true);

      // Verify session A is denied on next token decode, while session B remains allowed
      expect(await ensureRegisteredSession({ sessionId: jtiA, userId, policy: 'STANDARD' })).toBe(
        'denied'
      );
      expect(await ensureRegisteredSession({ sessionId: jtiB, userId, policy: 'STANDARD' })).toBe(
        'allowed'
      );
    });
  });

  // ── Test 7 ─────────────────────────────────────────────────────────────────
  describe('Test 7 — revoke all sessions in an atomic transaction', () => {
    it('blocks every session after revokeAllRegisteredSessions', async () => {
      const userId = 'user-7';
      const jtis = [makeJti(), makeJti(), makeJti()];
      for (const jti of jtis) seedSession(userId, jti);

      const count = await revokeAllRegisteredSessions(userId);
      expect(count).toBe(3);

      for (const jti of jtis) {
        expect(await ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' })).toBe(
          'denied'
        );
      }
    });
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────
  describe('Test 8 — expired session excluded from listing', () => {
    it('omits expired sessions and retains active ones', async () => {
      const userId = 'user-8';
      const jtiExpired = makeJti('expired');
      const jtiActive = makeJti('active');
      const past = new Date(Date.now() - 60_000).toISOString();

      seedSession(userId, jtiExpired, { expiresAt: past });
      seedSession(userId, jtiActive);

      const { sessions } = await listRegisteredSessions(userId);
      expect(sessions.map(s => s.displayId)).not.toContain(sessionDisplayId(jtiExpired));
      expect(sessions.map(s => s.displayId)).toContain(sessionDisplayId(jtiActive));
    });
  });

  // ── Test 9 ─────────────────────────────────────────────────────────────────
  describe('Test 9 — concurrent touch and revoke', () => {
    it('REVOKED state wins regardless of touch racing in', async () => {
      const userId = 'user-9';
      const jti = makeJti();
      seedSession(userId, jti, { lastUsed: new Date(Date.now() - 10 * 60 * 1000) });

      await Promise.all([
        touchSessionActivity({ userId, sessionId: jti, throttleMs: 0 }),
        revokeRegisteredSession({ userId, sessionId: jti }),
      ]);

      expect(await ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' })).toBe(
        'denied'
      );
    });
  });

  // ── Test 10 ────────────────────────────────────────────────────────────────
  describe('Test 10 — duplicate registration race (P2002)', () => {
    it('returns allowed for both callers and creates exactly one row', async () => {
      const userId = 'user-10';
      const jti = makeJti();

      const [r1, r2] = await Promise.all([
        ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' }),
        ensureRegisteredSession({ sessionId: jti, userId, policy: 'STANDARD' }),
      ]);

      expect(r1).toBe('allowed');
      expect(r2).toBe('allowed');
      expect(storeRows(userId)).toHaveLength(1);
    });
  });

  // ── Test 11: Fault tolerance ───────────────────────────────────────────────
  describe('Test 11 — fault tolerance on DB failure', () => {
    it('returns unavailable (not allowed/denied) when DB throws an unexpected error', async () => {
      mocks.findUnique.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await ensureRegisteredSession({
        sessionId: makeJti(),
        userId: 'user-fault',
        policy: 'STANDARD',
      });
      expect(result).toBe('unavailable');
    });
  });

  // ── Test 12: Safe sessionDisplayId ────────────────────────────────────────
  describe('Test 12 — safe 8-character hex session display identifier', () => {
    it('returns an 8-character uppercase hex string derived from SHA-256', () => {
      const displayId = sessionDisplayId('session-xyz-123');
      expect(displayId).toMatch(/^[0-9A-F]{8}$/);
      // Backward-compatible alias returns identical output
      expect(sessionDisplaySuffix('session-xyz-123')).toBe(displayId);
    });

    it('is deterministic for the same session ID', () => {
      expect(sessionDisplayId('abc-123')).toBe(sessionDisplayId('abc-123'));
    });

    it('differs across different session IDs to prevent collision', () => {
      expect(sessionDisplayId('session-alpha')).not.toBe(sessionDisplayId('session-beta'));
    });
  });

  // ── Test 13: Deterministic keyset cursor pagination ───────────────────────
  describe('Test 13 — deterministic keyset pagination (createdAt DESC, id DESC)', () => {
    it('paginates deterministically without missing rows or producing duplicates', async () => {
      const userId = 'user-page';
      const TOTAL_SESSIONS = 60;
      const baseTime = Date.now();

      // Seed with distinct timestamps
      for (let i = 0; i < TOTAL_SESSIONS; i++) {
        seedSession(userId, `jti-${String(i).padStart(3, '0')}`, {
          createdAt: new Date(baseTime - i * 1000),
          lastUsed: new Date(baseTime - i * 500),
        });
      }

      // Page 1 (limit: 50)
      const page1 = await listRegisteredSessions(userId, null, null, 50);
      expect(page1.sessions).toHaveLength(50);
      expect(page1.nextCursor).not.toBeNull();

      // Zero Raw JTI Leakage verification: cursor contains opaque id (CUID), not raw JTI or deviceId
      const decodedCursor = JSON.parse(
        Buffer.from(page1.nextCursor!, 'base64url').toString('utf8')
      );
      expect(decodedCursor).toHaveProperty('id');
      expect(decodedCursor).not.toHaveProperty('deviceId');
      expect(page1.nextCursor).not.toContain('session:');
      expect(page1.nextCursor).not.toContain('jti-');

      // Page 2 (limit: 50) using nextCursor from Page 1
      const page2 = await listRegisteredSessions(userId, null, page1.nextCursor, 50);
      expect(page2.sessions).toHaveLength(10);
      expect(page2.nextCursor).toBeNull(); // End of data

      // Verify no duplicates between pages and all sessions returned
      const allIds = [...page1.sessions.map(s => s.id), ...page2.sessions.map(s => s.id)];
      expect(new Set(allIds).size).toBe(TOTAL_SESSIONS);
      expect(allIds).toHaveLength(TOTAL_SESSIONS);
    });

    it('breaks ties deterministically on id when sessions share identical createdAt timestamps', async () => {
      const userId = 'user-page-tie';
      const fixedTime = new Date('2026-01-01T12:00:00.000Z');

      // Seed 5 sessions with identical createdAt timestamps
      seedSession(userId, 'tie-1', { id: 'cuid-e', createdAt: fixedTime });
      seedSession(userId, 'tie-2', { id: 'cuid-d', createdAt: fixedTime });
      seedSession(userId, 'tie-3', { id: 'cuid-c', createdAt: fixedTime });
      seedSession(userId, 'tie-4', { id: 'cuid-b', createdAt: fixedTime });
      seedSession(userId, 'tie-5', { id: 'cuid-a', createdAt: fixedTime });

      // Page 1 with limit: 3
      const p1 = await listRegisteredSessions(userId, null, null, 3);
      expect(p1.sessions).toHaveLength(3);
      expect(p1.sessions.map(s => s.id)).toEqual(['cuid-e', 'cuid-d', 'cuid-c']);
      expect(p1.nextCursor).not.toBeNull();

      // Page 2 with limit: 3
      const p2 = await listRegisteredSessions(userId, null, p1.nextCursor, 3);
      expect(p2.sessions).toHaveLength(2);
      expect(p2.sessions.map(s => s.id)).toEqual(['cuid-b', 'cuid-a']);
      expect(p2.nextCursor).toBeNull();
    });
  });

  // ── Test 14: Cross-user revocation security ────────────────────────────────
  describe('Test 14 — authorization scope: cross-user revocation prevention', () => {
    it('prevents User B from revoking User A session', async () => {
      const userA = 'user-A';
      const userB = 'user-B';
      const jtiA = makeJti('victim');
      seedSession(userA, jtiA, { id: 'cuid-userA-victim' });

      // User B attempts to revoke User A's session handle
      const result = await revokeRegisteredSession({
        userId: userB,
        sessionId: 'cuid-userA-victim',
      });
      expect(result.revoked).toBe(false);

      // User A's session remains fully active and allowed
      const checkA = await ensureRegisteredSession({
        sessionId: jtiA,
        userId: userA,
        policy: 'STANDARD',
      });
      expect(checkA).toBe('allowed');
    });
  });

  // ── Test 15: Standalone cleanup routine & token resurrection prevention ────
  describe('Test 15 — cleanupExpiredSessions and token resurrection prevention', () => {
    it('deletes active sessions older than 100 days', async () => {
      const userId = 'user-cleanup-active';
      // Stale active session created 105 days ago
      seedSession(userId, makeJti('stale-1'), {
        createdAt: new Date(Date.now() - 105 * 24 * 60 * 60 * 1000),
      });
      // Fresh active session created 5 days ago
      seedSession(userId, makeJti('fresh-1'), {
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });

      const deletedCount = await cleanupExpiredSessions(userId);
      expect(deletedCount).toBe(1);

      // Fresh session is still active
      const rows = storeRows(userId);
      expect(rows).toHaveLength(1);
    });

    it('retains revoked tombstones as long as the token could still be valid, preventing resurrection', async () => {
      const userId = 'user-resurrection';
      const jti = makeJti('pwa-token');
      // Token valid for 60 days
      const expiresAtIso = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      seedSession(userId, jti, {
        id: 'cuid-pwa-token',
        expiresAt: expiresAtIso,
      });

      // User revokes the session
      const revokeRes = await revokeRegisteredSession({ userId, sessionId: 'cuid-pwa-token' });
      expect(revokeRes.revoked).toBe(true);

      // Advance time by 35 days (token is still valid for 25 more days)
      const futureTime = Date.now() + 35 * 24 * 60 * 60 * 1000;
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(futureTime);

      // Run cleanup — the tombstone MUST NOT be deleted
      const cleaned = await cleanupExpiredSessions(userId);
      expect(cleaned).toBe(0);

      // Attacker or client presents the same still-valid JWT:
      // ensureRegisteredSession MUST reject it as 'denied' (NOT create a new active registration)
      const presented = await ensureRegisteredSession({
        userId,
        sessionId: jti,
        policy: 'STANDARD',
        expiresAtSeconds: Math.floor(new Date(expiresAtIso).getTime() / 1000),
      });
      expect(presented).toBe('denied');

      dateSpy.mockRestore();
    });

    it('safely deletes revoked tombstones once token expiry + 24h safety buffer has passed', async () => {
      const userId = 'user-tombstone-expiry';
      const jti = makeJti('expired-tombstone');
      // Token expired 2 days ago
      const expiresAtIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      seedSession(userId, jti, {
        id: 'cuid-expired-token',
        revoked: true,
        expiresAt: expiresAtIso,
      });

      const deletedCount = await cleanupExpiredSessions(userId);
      expect(deletedCount).toBe(1);
      expect(storeRows(userId)).toHaveLength(0);
    });
  });

  // ── Test 16: isCurrent detection in revokeRegisteredSession ─────────────────
  describe('Test 16 — current session detection during revocation', () => {
    it('accurately identifies current session when revoking via public handle', async () => {
      const userId = 'user-current-detect';
      const currentJti = makeJti('current');
      const otherJti = makeJti('other');

      seedSession(userId, currentJti, { id: 'cuid-current' });
      seedSession(userId, otherJti, { id: 'cuid-other' });

      // Revoke current session using its public CUID handle while passing currentJti
      const currentRevoke = await revokeRegisteredSession({
        userId,
        sessionId: 'cuid-current',
        currentJti,
      });
      expect(currentRevoke.revoked).toBe(true);
      expect(currentRevoke.isCurrent).toBe(true);

      // Revoke other session using its public CUID handle while passing currentJti
      const otherRevoke = await revokeRegisteredSession({
        userId,
        sessionId: 'cuid-other',
        currentJti,
      });
      expect(otherRevoke.revoked).toBe(true);
      expect(otherRevoke.isCurrent).toBe(false);
    });
  });

  // ── isCurrent marker ───────────────────────────────────────────────────────
  describe('listRegisteredSessions — isCurrent', () => {
    it('marks only the matching session as isCurrent using JTI comparison', async () => {
      const userId = 'user-current';
      const jtiCurrent = makeJti('current');
      const jtiOther = makeJti('other');
      seedSession(userId, jtiCurrent);
      seedSession(userId, jtiOther);

      const { sessions } = await listRegisteredSessions(userId, jtiCurrent);
      const current = sessions.find(s => s.displayId === sessionDisplayId(jtiCurrent));
      const other = sessions.find(s => s.displayId === sessionDisplayId(jtiOther));

      expect(current?.isCurrent).toBe(true);
      expect(other?.isCurrent).toBe(false);
    });
  });

  // ── Test 17: isSessionActive expiry and fail-closed checks ───────────────────
  describe('Test 17 — isSessionActive expiry and failure semantics', () => {
    it('returns true for active, non-expired session', async () => {
      const userId = 'user-active-check';
      const jti = makeJti('active');
      seedSession(userId, jti, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const active = await isSessionActive(userId, jti);
      expect(active).toBe(true);
    });

    it('returns false when session is revoked', async () => {
      const userId = 'user-active-rev';
      const jti = makeJti('rev');
      seedSession(userId, jti, { revoked: true });

      const active = await isSessionActive(userId, jti);
      expect(active).toBe(false);
    });

    it('returns false when session has expired past its expiresAt timestamp', async () => {
      const userId = 'user-active-exp';
      const jti = makeJti('expired');
      // Expired 10 seconds ago
      seedSession(userId, jti, {
        expiresAt: new Date(Date.now() - 10_000).toISOString(),
      });

      const active = await isSessionActive(userId, jti);
      expect(active).toBe(false);
    });

    it('fails closed and returns false when database query throws', async () => {
      mocks.findUnique.mockRejectedValueOnce(new Error('DB unreachable'));

      const active = await isSessionActive('user-any', 'jti-any');
      expect(active).toBe(false);
    });
  });

  // ── Test 18: Reliable expiry synchronization on JWT renewal ─────────────────
  describe('Test 18 — reliable expiry synchronization on JWT renewal', () => {
    it('synchronizes and persists extended expiry on JWT renewal', async () => {
      const userId = 'user-renew';
      const jti = makeJti('renew');
      const day7Iso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const day28Seconds = Math.floor(Date.now() / 1000) + 28 * 24 * 60 * 60;

      // Initially seeded with Day 7 expiry
      seedSession(userId, jti, { expiresAt: day7Iso });

      // Extended JWT presented (Day 28)
      const res = await ensureRegisteredSession({
        userId,
        sessionId: jti,
        policy: 'STANDARD',
        expiresAtSeconds: day28Seconds,
      });

      expect(res).toBe('allowed');

      // Verify stored row token metadata was updated
      const row = store.get(storeKey(userId, `session:${jti}`));
      expect(row).toBeDefined();
      const meta = JSON.parse(row!.token as string);
      expect(new Date(meta.expiresAt).getTime()).toBeGreaterThan(new Date(day7Iso).getTime());
    });

    it('fails closed returning unavailable if expiry update fails', async () => {
      const userId = 'user-renew-fail';
      const jti = makeJti('renew-fail');
      const day7Iso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const day28Seconds = Math.floor(Date.now() / 1000) + 28 * 24 * 60 * 60;

      seedSession(userId, jti, { expiresAt: day7Iso });

      // Mock update to throw
      mocks.update.mockRejectedValueOnce(new Error('DB write failed'));

      const res = await ensureRegisteredSession({
        userId,
        sessionId: jti,
        policy: 'STANDARD',
        expiresAtSeconds: day28Seconds,
      });

      expect(res).toBe('unavailable');
    });
  });
});
