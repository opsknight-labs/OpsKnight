// @vitest-environment node
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { revokeAuthenticationSession } from '@/lib/auth-control/sessions';
import { ensureRegisteredSession, isSessionActive } from '@/lib/session-registry';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { authenticationDiagnosticPage } from '@/lib/auth-control/diagnostic-queries';
import { diagnosticQuerySchema } from '@/lib/auth-control/diagnostic-contract';
import type { ControlActor } from '@/lib/auth-control/actor';
vi.mock('@/lib/secret-manager', () => ({
  getNextAuthSecret: async () => 'local-diagnostic-postgres-certification',
}));
// The dedicated certification job owns this database and its 100k-row load fixture.
const suite =
  process.env.VITEST_USE_REAL_DB === '1' &&
  new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test')
    ? describe
    : describe.skip;
const actor: ControlActor = {
  kind: 'admin',
  id: 'diagnostic-certifier',
  tokenVersion: 0,
  authenticatedAt: Date.now(),
};
const query = (input: Record<string, unknown>) =>
  diagnosticQuerySchema.parse({ range: 'all', ...input });
const measurements: Array<{ records: number; firstPageMs: number }> = [];
const plans: unknown[] = [];
const at = new Date('2026-10-01T00:00:00Z');
suite('authentication diagnostics with real PostgreSQL', () => {
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test required');
    await prisma.authenticationPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', mode: 'SSO_OPTIONAL', version: 1, legacySnapshot: {} },
      update: {
        mode: 'SSO_OPTIONAL',
        version: 1,
        passwordSessionMinVersion: 0,
        oidcSessionMinVersion: 0,
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
      },
    });
    await prisma.user.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        email: 'diagnostic@example.test',
        name: 'Diagnostic custodian',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      update: {},
    });
  });
  afterAll(async () => {
    writeFileSync(
      'plans/certification/authentication-experience-diagnostics.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          database: process.env.SSO_CERT_DB_ENGINE ?? 'Docker PostgreSQL; isolated local fixture',
          scope:
            'Isolated local PostgreSQL; query timing includes policy read and signed cursor generation; not a production capacity claim',
          measurements,
          plans,
        },
        null,
        2
      ) + '\n'
    );
    await prisma.userDevice.deleteMany({ where: { userId: actor.id } });
    await prisma.emergencyAccessEvent.deleteMany({
      where: { eventType: { startsWith: 'diagnostic-cert:' } },
    });
    await prisma.authenticationAlert.deleteMany({
      where: { id: { startsWith: 'diagnostic-delivery-' } },
    });
    await prisma.authenticationReplicaObservation.deleteMany({
      where: { id: { startsWith: 'diagnostic-replica-' } },
    });
    await prisma.user.delete({ where: { id: actor.id } });
  });
  it.each([0, 1, 24, 25, 26, 50, 100, 10000, 100000])(
    'paginates %i matching rows with tied timestamps and a bounded first page',
    async count => {
      await prisma.userDevice.deleteMany({ where: { userId: actor.id } });
      await prisma.$executeRaw`INSERT INTO "UserDevice" (id,"userId","deviceId",platform,token,"lastUsed","createdAt","updatedAt","sessionExpiresAt","sessionPolicyVersion","sessionDiagnosticProjectedAt") SELECT 'diagnostic-' || lpad(n::text,6,'0'),${actor.id},'session:diagnostic-' || n,'session:OIDC','{"expiresAt":"2027-01-01T00:00:00Z","issuedUnderPolicyVersion":1}',${at},${at},${at},TIMESTAMP '2027-01-01',1,${at} FROM generate_series(1,${count}) n`;
      const started = performance.now();
      const first = await authenticationDiagnosticPage(
        actor,
        query({ q: 'diagnostic', method: 'oidc', pageSize: 25 })
      );
      measurements.push({
        records: count,
        firstPageMs: Math.round((performance.now() - started) * 100) / 100,
      });
      expect(first.items).toHaveLength(Math.min(count, 25));
      expect(first.hasMore).toBe(count > 25);
      expect(JSON.stringify(first)).not.toContain('issuedUnderPolicyVersion');
      if (first.nextCursor) {
        const second = await authenticationDiagnosticPage(
          actor,
          query({ q: 'diagnostic', method: 'oidc', pageSize: 25, after: first.nextCursor })
        );
        expect(second.items).toHaveLength(Math.min(count - 25, 25));
        expect(second.items.every(value => !first.items.some(prior => prior.id === value.id))).toBe(
          true
        );
        expect(second.snapshotAt).toBe(first.snapshotAt);
      }
    },
    30000
  );
  it('filters methods before limit even with more than 100 newer password sessions', async () => {
    await prisma.$executeRaw`UPDATE "UserDevice" SET platform='session:STANDARD',"lastUsed"=TIMESTAMP '2026-10-02' WHERE "userId"=${actor.id} AND id > 'diagnostic-000100'`;
    const page = await authenticationDiagnosticPage(
      actor,
      query({ q: 'diagnostic', method: 'oidc' })
    );
    expect(page.items).toHaveLength(25);
    expect(page.items.every(value => Number(value.id.slice(-6)) <= 100)).toBe(true);
  });
  it('rejects a cursor reused with changed filters and omits records changed after snapshot', async () => {
    const first = await authenticationDiagnosticPage(
      actor,
      query({ q: 'diagnostic', method: 'oidc' })
    );
    expect(first.nextCursor).toBeTruthy();
    await expect(
      authenticationDiagnosticPage(
        actor,
        query({ q: 'diagnostic', method: 'credentials', after: first.nextCursor })
      )
    ).rejects.toThrow(/filters/);
    await prisma.userDevice.update({
      where: { id: 'diagnostic-000050' },
      data: { platform: 'session:REVOKED:OIDC' },
    });
    const next = await authenticationDiagnosticPage(
      actor,
      query({ q: 'diagnostic', method: 'oidc', after: first.nextCursor })
    );
    expect(next.items.some(value => value.id === 'diagnostic-000050')).toBe(false);
  });
  it('computes expired and revoked states from persisted policy and expiry', async () => {
    await prisma.userDevice.update({
      where: { id: 'diagnostic-000001' },
      data: { sessionExpiresAt: new Date('2020-01-01') },
    });
    await prisma.userDevice.update({
      where: { id: 'diagnostic-000002' },
      data: { sessionPolicyVersion: -1 },
    });
    for (const [state, id] of [
      ['EXPIRED', 'diagnostic-000001'],
      ['REVOKED', 'diagnostic-000002'],
    ] as const) {
      const result = await authenticationDiagnosticPage(actor, query({ q: id, state }));
      expect(result.items[0]?.state).toBe(state);
      expect(result.items[0]?.canRevoke).toBe(false);
    }
  });
  it('paginates audit evidence, applies filters and excludes unapproved context', async () => {
    await prisma.emergencyAccessEvent.createMany({
      data: Array.from({ length: 26 }, (_, n) => ({
        id: `diagnostic-audit-${String(n).padStart(3, '0')}`,
        emergencyAccountId: actor.id,
        eventType: 'diagnostic-cert:rotation',
        outcome: 'success',
        createdAt: at,
        context: {
          reason: 'authorized rotation',
          password: 'must-never-leak',
          token: 'must-never-leak',
          authorizedBy: `admin:${actor.id}`,
        },
      })),
    });
    const first = await authenticationDiagnosticPage(
      actor,
      query({
        view: 'audit',
        eventType: 'diagnostic-cert:rotation',
        outcome: 'success',
        actor: actor.id,
      })
    );
    expect(first.items).toHaveLength(25);
    expect(JSON.stringify(first)).not.toContain('must-never-leak');
    const second = await authenticationDiagnosticPage(
      actor,
      query({
        view: 'audit',
        eventType: 'diagnostic-cert:rotation',
        outcome: 'success',
        actor: actor.id,
        after: first.nextCursor,
      })
    );
    expect(second.items).toHaveLength(1);
  });
  it('paginates persisted security delivery evidence and never invents provider stages', async () => {
    await prisma.authenticationAlert.createMany({
      data: Array.from({ length: 26 }, (_, n) => ({
        id: `diagnostic-delivery-${String(n).padStart(3, '0')}`,
        eventId: `diagnostic-event-${n}`,
        recipientId: actor.id,
        title: 'Diagnostic delivery fixture',
        message: 'Local fixture',
        createdAt: at,
        failedAt: at,
        attempts: 3,
        deliveryGeneration: 2,
        lastError: '{"access_token":"must-never-leak"}',
      })),
    });
    const first = await authenticationDiagnosticPage(
      actor,
      query({ view: 'deliveries', q: 'Diagnostic delivery', state: 'FAILED' })
    );
    expect(first.items).toHaveLength(25);
    expect(first.items[0]).toMatchObject({ canRetry: true, generation: 2 });
    expect(first.items[0].timeline?.map(value => value.label)).toEqual(['Queued', 'Failed']);
    expect(JSON.stringify(first)).not.toContain('must-never-leak');
    const second = await authenticationDiagnosticPage(
      actor,
      query({
        view: 'deliveries',
        q: 'Diagnostic delivery',
        state: 'FAILED',
        after: first.nextCursor,
      })
    );
    expect(second.items).toHaveLength(1);
    await prisma.authenticationAlert.update({
      where: { id: 'diagnostic-delivery-000' },
      data: { failedAt: null, acceptedAt: at },
    });
    const accepted = await authenticationDiagnosticPage(
      actor,
      query({ view: 'deliveries', q: 'Diagnostic delivery', state: 'ACCEPTED' })
    );
    expect(accepted.items).toHaveLength(1);
    expect(accepted.items[0].canRetry).toBe(false);
    expect(accepted.items[0].timeline?.some(value => value.label === 'Delivery confirmed')).toBe(
      false
    );
  });
  it('separates recent replica reports from history and exposes mismatch names without legacy secrets', async () => {
    const recent = new Date(Date.now() - 5000);
    await prisma.authenticationReplicaObservation.createMany({
      data: Array.from({ length: 26 }, (_, n) => ({
        id: `diagnostic-replica-${String(n).padStart(3, '0')}`,
        firstSeenAt: at,
        lastSeenAt: recent,
        differs: n % 2 === 0,
        snapshot: { localLoginEnabled: true, breakGlassEmail: 'must-never-leak@example.test' },
      })),
    });
    const first = await authenticationDiagnosticPage(
      actor,
      query({ view: 'replicas', q: 'diagnostic-replica-', observation: 'active' })
    );
    expect(first.items).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(JSON.stringify(first)).not.toContain('must-never-leak');
    expect(first.items.find(item => item.state === 'CONFLICTING')?.details).toContainEqual(
      expect.objectContaining({
        label: 'Mismatching settings',
        value: expect.stringContaining('breakGlassEmail'),
      })
    );
    const second = await authenticationDiagnosticPage(
      actor,
      query({
        view: 'replicas',
        q: 'diagnostic-replica-',
        observation: 'active',
        after: first.nextCursor,
      })
    );
    expect(second.items).toHaveLength(1);
    await prisma.authenticationReplicaObservation.update({
      where: { id: 'diagnostic-replica-000' },
      data: { lastSeenAt: new Date(Date.now() - 7200000) },
    });
    const historical = await authenticationDiagnosticPage(
      actor,
      query({ view: 'replicas', q: 'diagnostic-replica-', observation: 'historical' })
    );
    expect(historical.items).toHaveLength(1);
    expect(historical.items[0].details.some(value => value.value.includes('Historical'))).toBe(
      true
    );
  });
  it('uses the composite activity index for a deep unfiltered page at 100k scale', async () => {
    await prisma.$executeRaw`ANALYZE "UserDevice"`;
    const result = await prisma.$queryRaw<
      Array<{ 'QUERY PLAN': unknown }>
    >`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,"lastUsed" FROM "UserDevice" WHERE ("lastUsed",id) < (${at},'diagnostic-050000') ORDER BY "lastUsed" DESC,id DESC LIMIT 26`;
    plans.push(result);
    const plan = JSON.stringify(result);
    expect(plan).toContain('UserDevice_diagnostic_activity_idx');
    console.info('DIAGNOSTIC_EXPLAIN', plan);
  });
  it('builds indexes and backfills under concurrent session authorization without changing authentication metadata', async () => {
    await prisma.$executeRaw`UPDATE "UserDevice" SET "sessionPolicyVersion"=NULL,"sessionExpiresAt"=NULL,"sessionDiagnosticProjectedAt"=NULL WHERE "userId"=${actor.id} AND id <= 'diagnostic-010000'`;
    const original = await prisma.userDevice.findUniqueOrThrow({
      where: { id: 'diagnostic-000002' },
    });
    expect(
      await ensureRegisteredSession({
        userId: actor.id,
        sessionId: 'diagnostic-live-certification',
        policy: 'OIDC',
        issuedUnderPolicyVersion: 1,
        expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toBe('allowed');
    // Owned fixture only: prove index construction itself overlaps live authorization.
    await prisma.$executeRawUnsafe('DROP INDEX "UserDevice_diagnostic_activity_idx"');
    const [walBefore] = await prisma.$queryRaw<
      Array<{ lsn: string }>
    >`SELECT pg_current_wal_lsn()::text AS lsn`;
    let running = true;
    const latencies: number[] = [];
    let exclusiveLocks = 0;
    const load = (async () => {
      while (running) {
        const start = performance.now();
        expect(await isSessionActive(actor.id, 'diagnostic-live-certification')).toBe(true);
        await prisma.emergencyAccessEvent.create({
          data: { eventType: 'diagnostic-cert:online-deployment', outcome: 'SUCCESS', context: {} },
        });
        latencies.push(performance.now() - start);
        const [locks] = await prisma.$queryRaw<
          Array<{ count: number }>
        >`SELECT count(*)::int AS count FROM pg_locks WHERE relation = '"UserDevice"'::regclass AND mode='AccessExclusiveLock' AND granted`;
        exclusiveLocks += locks.count;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    })();
    const started = performance.now();
    try {
      await promisify(execFile)(
        process.execPath,
        ['scripts/prepare-authentication-diagnostics.cjs'],
        { env: { ...process.env, DIRECT_DATABASE_URL: process.env.DATABASE_URL }, timeout: 60000 }
      );
    } finally {
      running = false;
      await load;
    }
    const [wal] = await prisma.$queryRaw<
      Array<{ bytes: string }>
    >`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), ${walBefore.lsn}::pg_lsn)::text AS bytes`;
    const restored = await prisma.userDevice.findUniqueOrThrow({ where: { id: original.id } });
    expect(restored.sessionPolicyVersion).toBe(1);
    expect(restored.sessionExpiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(restored.token).toBe(original.token);
    expect(restored.updatedAt).toEqual(original.updatedAt);
    expect(exclusiveLocks).toBe(0);
    expect(latencies.length).toBeGreaterThan(5);
    writeFileSync(
      'plans/certification/authentication-experience-online-deployment.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          scope:
            'Isolated PostgreSQL, 100k existing sessions, 10k historical projections, concurrent registry authorization and durable security events; not production capacity or full IdP certification',
          durationMs: Math.round(performance.now() - started),
          walBytes: Number(wal.bytes),
          authorizationAndEventSamples: latencies.length,
          worstAuthorizationAndEventMs: Math.round(Math.max(...latencies)),
          observedAccessExclusiveLocks: exclusiveLocks,
        },
        null,
        2
      ) + '\n'
    );
  }, 90000);
  it('reconciles a row locked during the initial scan and marks legitimate missing metadata complete', async () => {
    const row = await prisma.userDevice.create({
      data: {
        userId: actor.id,
        id: 'diagnostic-locked-history',
        deviceId: 'session:locked-history',
        platform: 'session:STANDARD',
        token: '{}',
      },
    });
    await expect(authenticationDiagnosticPage(actor, query({ view: 'sessions' }))).rejects.toThrow(
      'preparation is incomplete'
    );
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => {
      locked = resolve;
    });
    const releaseLock = new Promise<void>(resolve => {
      release = resolve;
    });
    const locker = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "UserDevice" WHERE id=${row.id} FOR UPDATE`;
        locked();
        await releaseLock;
      },
      { timeout: 30000 }
    );
    await acquired;
    let reconciled = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/prepare-authentication-diagnostics.cjs'], {
          env: { ...process.env, DIRECT_DATABASE_URL: process.env.DATABASE_URL },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => {
          output += String(chunk);
          if (output.includes('reconciling')) {
            reconciled = true;
            release();
          }
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0 ? resolve() : reject(new Error('Isolated preparation process failed.'))
        );
      });
    } finally {
      release();
      await locker;
    }
    expect(reconciled).toBe(true);
    const restored = await prisma.userDevice.findUniqueOrThrow({ where: { id: row.id } });
    expect(restored.sessionDiagnosticProjectedAt).toBeInstanceOf(Date);
    expect(restored.sessionPolicyVersion).toBeNull();
    expect(restored.sessionExpiresAt).toBeNull();
    const before = restored.sessionDiagnosticProjectedAt;
    await promisify(execFile)(
      process.execPath,
      ['scripts/prepare-authentication-diagnostics.cjs'],
      { env: { ...process.env, DIRECT_DATABASE_URL: process.env.DATABASE_URL }, timeout: 30000 }
    );
    expect(
      (await prisma.userDevice.findUniqueOrThrow({ where: { id: row.id } }))
        .sessionDiagnosticProjectedAt
    ).toEqual(before);
  }, 45000);
  it('reconciles successfully when a row lock is held for 10–12 seconds, exceeding initial pass limits', async () => {
    const row = await prisma.userDevice.create({
      data: {
        userId: actor.id,
        id: 'diagnostic-sustained-lock',
        deviceId: 'session:sustained-lock',
        platform: 'session:STANDARD',
        token: '{"issuedUnderPolicyVersion": 1, "expiresAt": "2027-01-01T00:00:00.000Z"}',
      },
    });
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => {
      locked = resolve;
    });
    const releaseLock = new Promise<void>(resolve => {
      release = resolve;
    });
    const locker = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "UserDevice" WHERE id=${row.id} FOR UPDATE`;
        locked();
        await releaseLock;
      },
      { timeout: 30000 }
    );
    await acquired;
    const releaseTimer = setTimeout(() => {
      release();
    }, 10500);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/prepare-authentication-diagnostics.cjs'], {
          env: {
            ...process.env,
            DIRECT_DATABASE_URL: process.env.DATABASE_URL,
            AUTH_DIAGNOSTIC_DEADLINE_MS: '60000',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => {
          output += String(chunk);
        });
        child.stderr.on('data', chunk => {
          output += String(chunk);
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0
            ? resolve()
            : reject(new Error(`Preparation failed with code ${code}. Output: ${output}`))
        );
      });
    } finally {
      clearTimeout(releaseTimer);
      release();
      await locker;
    }
    const restored = await prisma.userDevice.findUniqueOrThrow({ where: { id: row.id } });
    expect(restored.sessionDiagnosticProjectedAt).toBeInstanceOf(Date);
    expect(restored.sessionPolicyVersion).toBe(1);
    expect(restored.sessionExpiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  }, 45000);
  it('blocks readiness on permanent contention and restarts successfully after lock clears', async () => {
    const row = await prisma.userDevice.create({
      data: {
        userId: actor.id,
        id: 'diagnostic-permanent-contention',
        deviceId: 'session:permanent-contention',
        platform: 'session:STANDARD',
        token: '{"issuedUnderPolicyVersion": 2}',
      },
    });
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => {
      locked = resolve;
    });
    const releaseLock = new Promise<void>(resolve => {
      release = resolve;
    });
    const locker = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "UserDevice" WHERE id=${row.id} FOR UPDATE`;
        locked();
        await releaseLock;
      },
      { timeout: 30000 }
    );
    await acquired;
    try {
      const failureCode = await new Promise<number | null>(resolve => {
        const child = spawn(process.execPath, ['scripts/prepare-authentication-diagnostics.cjs'], {
          env: {
            ...process.env,
            DIRECT_DATABASE_URL: process.env.DATABASE_URL,
            AUTH_DIAGNOSTIC_DEADLINE_MS: '2000',
          },
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        child.once('exit', code => resolve(code));
      });
      expect(failureCode).not.toBe(0);
      const unprojected = await prisma.userDevice.findUniqueOrThrow({ where: { id: row.id } });
      expect(unprojected.sessionDiagnosticProjectedAt).toBeNull();
    } finally {
      release();
      await locker;
    }
    await promisify(execFile)(
      process.execPath,
      ['scripts/prepare-authentication-diagnostics.cjs'],
      { env: { ...process.env, DIRECT_DATABASE_URL: process.env.DATABASE_URL }, timeout: 30000 }
    );
    const completed = await prisma.userDevice.findUniqueOrThrow({ where: { id: row.id } });
    expect(completed.sessionDiagnosticProjectedAt).toBeInstanceOf(Date);
    expect(completed.sessionPolicyVersion).toBe(2);
  }, 45000);
  it('reports self revocation by exact registered session, not merely by user identity', async () => {
    const own = 'diagnostic-revoke-current';
    const other = 'diagnostic-revoke-other';
    for (const sessionId of [own, other])
      expect(
        await ensureRegisteredSession({
          userId: actor.id,
          sessionId,
          policy: 'STANDARD',
          expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toBe('allowed');
    const ownRow = await prisma.userDevice.findUniqueOrThrow({
      where: { userId_deviceId: { userId: actor.id, deviceId: `session:${own}` } },
    });
    const otherRow = await prisma.userDevice.findUniqueOrThrow({
      where: { userId_deviceId: { userId: actor.id, deviceId: `session:${other}` } },
    });
    const currentActor: ControlActor = { ...actor, sessionId: own, method: 'credentials' };
    expect(await revokeAuthenticationSession(currentActor, otherRow.id)).toEqual({
      revokedCurrentSession: false,
    });
    expect(await isSessionActive(actor.id, own)).toBe(true);
    expect(await revokeAuthenticationSession(currentActor, ownRow.id)).toEqual({
      revokedCurrentSession: true,
    });
    expect(await isSessionActive(actor.id, own)).toBe(false);
  });
});
