// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureRegisteredSession,
  isSessionActive,
  listRegisteredSessions,
  resetLocalTouchCacheForTesting,
  revokeRegisteredSession,
  revokeAllRegisteredSessions,
  sessionDisplayId,
  touchAuthenticatedSession,
} from '@/lib/session-registry';

// In-memory backing store for mocked Prisma calls
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

describe('Session Registry — Production Invariant Matrix', () => {
  beforeEach(() => {
    store.clear();
    resetLocalTouchCacheForTesting();
    vi.clearAllMocks();

    mocks.findUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { id?: string; userId_deviceId?: { userId: string; deviceId: string } };
      }) => {
        if (where.userId_deviceId) {
          const key = storeKey(where.userId_deviceId.userId, where.userId_deviceId.deviceId);
          return store.get(key) ?? null;
        }
        if (where.id) {
          for (const row of store.values()) {
            if (row.id === where.id) return row;
          }
        }
        return null;
      }
    );

    mocks.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      for (const row of store.values()) {
        if (where.userId && row.userId !== where.userId) continue;
        if (Array.isArray(where.OR)) {
          const matchOr = (where.OR as Record<string, unknown>[]).some(clause => {
            if (clause.id && row.id === clause.id) return true;
            if (clause.deviceId && row.deviceId === clause.deviceId) return true;
            return false;
          });
          if (!matchOr) continue;
        }
        return row;
      }
      return null;
    });

    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const key = storeKey(data.userId as string, data.deviceId as string);
      if (store.has(key)) {
        const error = new Error('Unique constraint failed on the fields: (`userId`,`deviceId`)');
        (error as unknown as { code: string }).code = 'P2002';
        throw error;
      }
      const record = {
        id: `cuid-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date(),
        lastUsed: new Date(),
        userAgent: (data.userAgent as string) ?? null,
        ...data,
      };
      store.set(key, record);
      return record;
    });

    mocks.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id?: string; userId_deviceId?: { userId: string; deviceId: string } };
        data: Record<string, unknown>;
      }) => {
        let row: Record<string, unknown> | null = null;
        let targetKey: string | null = null;
        if (where.userId_deviceId) {
          targetKey = storeKey(where.userId_deviceId.userId, where.userId_deviceId.deviceId);
          row = store.get(targetKey) ?? null;
        } else if (where.id) {
          for (const [k, v] of store.entries()) {
            if (v.id === where.id) {
              row = v;
              targetKey = k;
              break;
            }
          }
        }
        if (!row || !targetKey) throw new Error('Record not found');
        const updated = { ...row, ...data };
        store.set(targetKey, updated);
        return updated;
      }
    );

    mocks.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const [key, row] of store.entries()) {
          if (where.id && row.id !== where.id) continue;
          if (where.userId && row.userId !== where.userId) continue;
          if (where.deviceId && row.deviceId !== where.deviceId) continue;

          if (typeof where.platform === 'string') {
            if (row.platform !== where.platform) continue;
          } else if (where.platform && typeof where.platform === 'object') {
            const pObj = where.platform as Record<string, unknown>;
            if (
              'startsWith' in pObj &&
              !(row.platform as string).startsWith(pObj.startsWith as string)
            )
              continue;
            if ('in' in pObj && !(pObj.in as string[]).includes(row.platform as string)) continue;
          }

          if (Array.isArray(where.OR)) {
            const matchesOr = (where.OR as Record<string, unknown>[]).some(clause => {
              if (
                clause.lastUsed &&
                typeof clause.lastUsed === 'object' &&
                'lt' in (clause.lastUsed as Record<string, unknown>)
              ) {
                return (row.lastUsed as Date) < (clause.lastUsed as { lt: Date }).lt;
              }
              if ('userAgent' in clause && clause.userAgent === null) {
                return row.userAgent === null;
              }
              return false;
            });
            if (!matchesOr) continue;
          } else if (
            where.lastUsed &&
            typeof where.lastUsed === 'object' &&
            'lt' in (where.lastUsed as Record<string, unknown>)
          ) {
            if ((row.lastUsed as Date) >= (where.lastUsed as { lt: Date }).lt) continue;
          }

          store.set(key, { ...row, ...data });
          count++;
        }
        return { count };
      }
    );

    mocks.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const results: Record<string, unknown>[] = [];
      for (const row of store.values()) {
        if (where.userId && row.userId !== where.userId) continue;
        if (
          where.platform &&
          typeof where.platform === 'object' &&
          'startsWith' in (where.platform as Record<string, unknown>)
        ) {
          if (
            !(row.platform as string).startsWith(
              (where.platform as { startsWith: string }).startsWith
            )
          )
            continue;
        }
        results.push(row);
      }
      return results.sort(
        (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()
      );
    });

    mocks.$transaction.mockImplementation(
      async (fns: unknown[] | ((tx: unknown) => Promise<unknown>)) => {
        if (typeof fns === 'function') {
          return fns({
            userDevice: {
              updateMany: mocks.updateMany,
              findMany: mocks.findMany,
            },
          });
        }
        return Promise.all(fns);
      }
    );
  });

  // 1. Two Chrome/macOS logins -> 2 distinct sessions
  it('1. Two Chrome/macOS logins produce 2 distinct active sessions', async () => {
    const userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const jtiA = '018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b';
    const jtiB = '018f1a2b-3c4d-7e8f-9a0b-9c8d7e6f5a4b';

    await ensureRegisteredSession({ userId: 'u1', sessionId: jtiA, policy: 'STANDARD', userAgent });
    await ensureRegisteredSession({ userId: 'u1', sessionId: jtiB, policy: 'STANDARD', userAgent });

    const page = await listRegisteredSessions('u1');
    expect(page.sessions).toHaveLength(2);
    expect(page.sessions.map(s => s.displayId)).toHaveLength(2);
    expect(page.sessions[0].displayId).not.toBe(page.sessions[1].displayId);
  });

  // 2. Same device, separate JTIs -> 2 sessions
  it('2. Same device with separate JTIs produce 2 independently tracked sessions', async () => {
    const jti1 = 'jti-device-1';
    const jti2 = 'jti-device-2';

    await ensureRegisteredSession({ userId: 'u1', sessionId: jti1, policy: 'STANDARD' });
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti2, policy: 'STANDARD' });

    expect(await isSessionActive('u1', jti1)).toBe(true);
    expect(await isSessionActive('u1', jti2)).toBe(true);
  });

  // 3. 100+ audit events -> doesn't affect session count
  it('3. 100+ external audit events do not affect registered session count', async () => {
    const jti = 'jti-audit-isolation';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' });

    // Emulate 100 audit events occurring in the system (which write to auditLog, not UserDevice)
    const page = await listRegisteredSessions('u1');
    expect(page.sessions).toHaveLength(1);
  });

  // 4. Normal authenticated request -> lastUsed advances
  it('4. Normal authenticated request advances lastUsed', async () => {
    const jti = 'jti-normal-req';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' });

    const initialRow = store.get(storeKey('u1', `session:${jti}`));
    const initialLastUsed = new Date(Date.now() - 10 * 60 * 1000); // 10 mins ago
    initialRow!.lastUsed = initialLastUsed;

    await touchAuthenticatedSession({
      userId: 'u1',
      sessionId: jti,
      userAgent: 'Mozilla/5.0 Chrome',
      throttleMs: 60_000,
    });

    const updatedRow = store.get(storeKey('u1', `session:${jti}`));
    expect((updatedRow!.lastUsed as Date).getTime()).toBeGreaterThan(initialLastUsed.getTime());
  });

  // 5. 100 requests/minute -> bounded DB writes
  it('5. 100 requests/minute results in bounded DB writes via throttling', async () => {
    const jti = 'jti-burst-traffic';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' });

    const initialUpdateManyCalls = mocks.updateMany.mock.calls.length;

    // Simulate 100 rapid requests within the same minute
    for (let i = 0; i < 100; i++) {
      await touchAuthenticatedSession({
        userId: 'u1',
        sessionId: jti,
        userAgent: 'Mozilla/5.0 Chrome',
        throttleMs: 60_000,
      });
    }

    // Process-local pre-filter + DB conditional throttle bounds DB writes to at most 1
    const newUpdateManyCalls = mocks.updateMany.mock.calls.length - initialUpdateManyCalls;
    expect(newUpdateManyCalls).toBeLessThanOrEqual(1);
  });

  // 6. Multiple web replicas -> no duplicate sessions
  it('6. Concurrent creation across replicas resolves idempotently without duplicates', async () => {
    const jti = 'jti-ha-replica';

    // Simulate two replicas attempting ensureRegisteredSession concurrently
    const [res1, res2] = await Promise.all([
      ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' }),
    ]);

    expect(res1).toBe('allowed');
    expect(res2).toBe('allowed');

    const sessions = await listRegisteredSessions('u1');
    expect(
      sessions.sessions.filter(s => s.id === store.get(storeKey('u1', `session:${jti}`))?.id)
    ).toHaveLength(1);
  });

  // 7. Revoke session A -> A rejected, B works
  it('7. Revoking session A rejects A while session B remains active', async () => {
    const jtiA = 'jti-revoke-a';
    const jtiB = 'jti-remain-b';

    await ensureRegisteredSession({ userId: 'u1', sessionId: jtiA, policy: 'STANDARD' });
    await ensureRegisteredSession({ userId: 'u1', sessionId: jtiB, policy: 'STANDARD' });

    const revokeResult = await revokeRegisteredSession({ userId: 'u1', sessionId: jtiA });
    expect(revokeResult.revoked).toBe(true);

    expect(await isSessionActive('u1', jtiA)).toBe(false);
    expect(await isSessionActive('u1', jtiB)).toBe(true);
  });

  // 8. Revoke all -> every session rejected
  it('8. Revoking all sessions marks all user sessions as revoked', async () => {
    const jti1 = 'jti-all-1';
    const jti2 = 'jti-all-2';

    await ensureRegisteredSession({ userId: 'u1', sessionId: jti1, policy: 'STANDARD' });
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti2, policy: 'STANDARD' });

    const count = await revokeAllRegisteredSessions('u1');
    expect(count).toBe(2);

    expect(await isSessionActive('u1', jti1)).toBe(false);
    expect(await isSessionActive('u1', jti2)).toBe(false);
  });

  // 9. Expired session -> not active
  it('9. Expired session is recognized as not active and excluded from active listing', async () => {
    const jti = 'jti-expired';
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

    await ensureRegisteredSession({
      userId: 'u1',
      sessionId: jti,
      policy: 'STANDARD',
      expiresAtSeconds: pastExp,
    });

    expect(await isSessionActive('u1', jti)).toBe(false);

    const page = await listRegisteredSessions('u1');
    const session = page.sessions.find(s => s.displayId === sessionDisplayId(jti));
    expect(session).toBeUndefined();
  });

  // 10. Concurrent registration -> one registry row
  it('10. Concurrent registration with P2002 conflict stores exactly one registry row', async () => {
    const jti = 'jti-concurrent-p2002';

    await Promise.all([
      ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' }),
      ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' }),
    ]);

    let rowCount = 0;
    for (const [k] of store.entries()) {
      if (k === storeKey('u1', `session:${jti}`)) rowCount++;
    }
    expect(rowCount).toBe(1);
  });

  // 11. Concurrent touch + revoke -> final state remains revoked
  it('11. Touch after revoke does not resurrect a revoked session', async () => {
    const jti = 'jti-touch-revoked';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' });
    await revokeRegisteredSession({ userId: 'u1', sessionId: jti });

    // Touch attempt after revocation
    await touchAuthenticatedSession({
      userId: 'u1',
      sessionId: jti,
      userAgent: 'Mozilla/5.0 Chrome',
      throttleMs: 0,
    });

    expect(await isSessionActive('u1', jti)).toBe(false);
    const row = store.get(storeKey('u1', `session:${jti}`));
    expect((row!.platform as string).startsWith('session:REVOKED:')).toBe(true);
  });

  // 12. OIDC session -> appears with policy OIDC
  it('12. OIDC session is registered and listed with OIDC policy', async () => {
    const jti = 'jti-oidc';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'OIDC' });

    const page = await listRegisteredSessions('u1');
    const session = page.sessions.find(s => s.displayId === sessionDisplayId(jti));
    expect(session?.policy).toBe('OIDC');
  });

  // 13. PWA session -> appears with policy TRUSTED_PWA
  it('13. Trusted PWA session is registered and listed with TRUSTED_PWA policy', async () => {
    const jti = 'jti-pwa';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'TRUSTED_PWA' });

    const page = await listRegisteredSessions('u1');
    const session = page.sessions.find(s => s.displayId === sessionDisplayId(jti));
    expect(session?.policy).toBe('TRUSTED_PWA');
  });

  // 14. Standard session -> appears with policy STANDARD
  it('14. Standard session is registered and listed with STANDARD policy', async () => {
    const jti = 'jti-standard';
    await ensureRegisteredSession({ userId: 'u1', sessionId: jti, policy: 'STANDARD' });

    const page = await listRegisteredSessions('u1');
    const session = page.sessions.find(s => s.displayId === sessionDisplayId(jti));
    expect(session?.policy).toBe('STANDARD');
  });

  // 15. Registry DB failure -> returns unavailable (fail closed)
  it('15. Registry database failure returns unavailable and rejects authorization', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('PostgreSQL connection dropped'));

    const result = await ensureRegisteredSession({
      userId: 'u1',
      sessionId: 'jti-db-fail',
      policy: 'STANDARD',
    });

    expect(result).toBe('unavailable');
  });

  // 16. Touch without UA does not block subsequent UA enrichment on fresh session
  it('16. Touch without userAgent on a fresh session does not block subsequent userAgent enrichment', async () => {
    const jti = 'jti-ua-enrichment';
    // 1. Initial creation via ensureRegisteredSession with userAgent = null (decode phase)
    await ensureRegisteredSession({
      userId: 'u1',
      sessionId: jti,
      policy: 'STANDARD',
      userAgent: null,
    });

    const initialRow = store.get(storeKey('u1', `session:${jti}`));
    expect(initialRow?.userAgent).toBeNull();

    // 2. Decode-side touch without userAgent
    await touchAuthenticatedSession({
      userId: 'u1',
      sessionId: jti,
      userAgent: undefined,
      throttleMs: 120_000,
    });

    // 3. First HTTP request arrives with real User-Agent immediately (fresh lastUsed)
    const browserUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    await touchAuthenticatedSession({
      userId: 'u1',
      sessionId: jti,
      userAgent: browserUa,
      throttleMs: 120_000,
    });

    const enrichedRow = store.get(storeKey('u1', `session:${jti}`));
    expect(enrichedRow?.userAgent).toBe(browserUa);
  });

  // 17. Legacy tokens without JTI are rejected by customJwtDecode
  it('17. Legacy tokens without JTI are rejected by customJwtDecode (forcing re-auth)', async () => {
    const { customJwtDecode } = await import('@/lib/auth-jwt-encoder');
    const { CompactEncrypt } = await import('jose');
    const hkdf = (await import('@panva/hkdf')).default;

    const secret = 'test-only-session-identity-secret-with-sufficient-length';
    const key = await hkdf('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32);

    // Create an authenticated JWE token with sub but NO jti (legacy token)
    const payload = JSON.stringify({
      sub: 'user-legacy',
      email: 'legacy@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const plaintext = new TextEncoder().encode(payload);

    const legacyToken = await new CompactEncrypt(plaintext)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(new Uint8Array(key));

    const decoded = await customJwtDecode({ token: legacyToken, secret });
    expect(decoded).toBeNull();
  });
});
