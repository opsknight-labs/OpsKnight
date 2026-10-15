// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { authenticationDiagnosticPage } from '@/lib/auth-control/diagnostic-queries';
import { diagnosticQuerySchema } from '@/lib/auth-control/diagnostic-contract';
import type { ControlActor } from '@/lib/auth-control/actor';
vi.mock('@/lib/secret-manager', () => ({
  getNextAuthSecret: async () => 'local-diagnostic-postgres-certification',
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
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
      await prisma.$executeRaw`INSERT INTO "UserDevice" (id,"userId","deviceId",platform,token,"lastUsed","createdAt","updatedAt","sessionExpiresAt","sessionPolicyVersion") SELECT 'diagnostic-' || lpad(n::text,6,'0'),${actor.id},'session:diagnostic-' || n,'session:OIDC','{"expiresAt":"2027-01-01T00:00:00Z","issuedUnderPolicyVersion":1}',${at},${at},${at},TIMESTAMP '2027-01-01',1 FROM generate_series(1,${count}) n`;
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
});
