// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { scimDriftAction } from '@/app/(app)/settings/system/scim-actions';
import { reconcileTeam } from '@/lib/scim/lifecycle/membership';
import { hashToken } from '@/lib/scim/security/credentials';
import { users } from '@/lib/scim/lifecycle/users';
import { groups } from '@/lib/scim/lifecycle/groups';
import { handle } from '@/lib/scim/protocol/http';
vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn() }));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
const suite =
  process.env.SCIM_LOAD_TEST === '1' &&
  process.env.SCIM_CERTIFICATION === '1' &&
  process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
const token = 'isolated-scim-load-certification-00000000000000001';
suite('SCIM indexed capacity certification', () => {
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_scim_test'))
      throw new Error('Use only enterprise_scim_test.');
    await prisma.scimConnector.upsert({
      where: { id: 'scim-load' },
      create: { id: 'scim-load', name: 'Isolated capacity fixture' },
      update: {},
    });
    await prisma.scimCredential.upsert({
      where: { tokenHash: hashToken(token) },
      create: {
        connectorId: 'scim-load',
        name: 'Capacity fixture',
        tokenHash: hashToken(token),
        tokenHint: token.slice(-4),
        scopes: ['users:read', 'groups:read', 'groups:write'],
        createdBy: 'capacity-certifier',
        expiresAt: new Date(Date.now() + 86400000),
      },
      update: {
        expiresAt: new Date(Date.now() + 86400000),
        scopes: ['users:read', 'groups:read', 'groups:write'],
      },
    });
    await prisma.$executeRaw`INSERT INTO "User" (id, email, name, status, "updatedAt") SELECT 'scim-load-user-' || i, 'scim-load-' || i || '@example.test', 'Capacity user ' || i, 'ACTIVE', CURRENT_TIMESTAMP FROM generate_series(1, 100000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimIdentity" (id, "connectorId", "externalId", "userId") SELECT 'scim-load-identity-' || i, 'scim-load', 'directory-' || i, 'scim-load-user-' || i FROM generate_series(1, 100000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimGroup" (id, "connectorId", name, "scimExternalId", "updatedAt") SELECT 'scim-load-group-' || i, 'scim-load', 'Capacity group ' || i, 'directory-group-' || i, CURRENT_TIMESTAMP FROM generate_series(1, 10000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId", "userId") SELECT 'scim-load-group-' || ((i - 1) / 10 + 1), 'scim-load-user-' || i FROM generate_series(1, 100000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId", "userId") SELECT 'scim-load-group-1', 'scim-load-user-' || i FROM generate_series(1, 10000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`ANALYZE "ScimIdentity"`;
    await prisma.$executeRaw`ANALYZE "ScimGroup"`;
    await prisma.$executeRaw`ANALYZE "User"`;
  }, 120000);
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('serves bounded searches/pagination at 100k users and 10k groups within local latency budgets', async () => {
    const lookupPlan =
      await prisma.$queryRaw`EXPLAIN (FORMAT JSON) SELECT id FROM "User" WHERE lower(email) = lower(${'SCIM-LOAD-99999@EXAMPLE.TEST'})`;
    expect(JSON.stringify(lookupPlan)).toContain('User_email_scim_lower_idx');
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const req = new NextRequest(
        `https://capacity.test/api/scim/v2/Users?filter=${encodeURIComponent(`externalId eq "directory-${90000 + i}"`)}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const response = await handle(() => users(req), req);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ totalResults: 1, itemsPerPage: 1 });
      durations.push(performance.now() - start);
    }
    const list = new NextRequest(
      'https://capacity.test/api/scim/v2/Users?startIndex=99901&count=100',
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(await (await users(list)).json()).toMatchObject({
      totalResults: 100000,
      itemsPerPage: 100,
    });
    const groupList = new NextRequest(
      'https://capacity.test/api/scim/v2/Groups?excludedAttributes=members&count=100',
      { headers: { authorization: `Bearer ${token}` } }
    );
    const body = await (await groups(groupList)).json();
    expect(body).toMatchObject({ totalResults: 10000, itemsPerPage: 100 });
    expect(body.Resources.every((row: Record<string, unknown>) => !('members' in row))).toBe(true);
    durations.sort((a, b) => a - b);
    process.stdout.write(
      JSON.stringify({
        users: 100000,
        groups: 10000,
        requests: durations.length,
        p95Ms: durations[94],
        p99Ms: durations[98],
        budget: { p95Ms: 2000, p99Ms: 5000 },
      }) + '\n'
    );
    expect(durations[94]).toBeLessThan(2000);
    expect(durations[98]).toBeLessThan(5000);
  }, 120000);
  it('uses the connector/externalId unique index for equality searches', async () => {
    const plan = await prisma.$queryRaw<
      Array<{ 'QUERY PLAN': string }>
    >`EXPLAIN SELECT "userId" FROM "ScimIdentity" WHERE "connectorId" = 'scim-load' AND "externalId" = 'directory-90000' AND "deletedAt" IS NULL`;
    expect(plan.map(row => row['QUERY PLAN']).join('\n')).toMatch(/Index (?:Only )?Scan/);
  });
  it('revokes a 10,000-member bound group within the standard transaction timeout', async () => {
    const team = await prisma.team.create({
      data: {
        name: `Capacity revocation ${Date.now()}`,
        members: { create: { userId: 'scim-load-user-100000', role: 'OWNER' } },
      },
    });
    const service = await prisma.service.create({
      data: { name: `Capacity service ${Date.now()}`, teamId: team.id },
    });
    await runSerializableTransaction(async tx => {
      await tx.scimGroupTeamBinding.create({
        data: {
          groupId: 'scim-load-group-1',
          teamId: team.id,
          approvedBy: 'capacity-certifier',
        },
      });
      await reconcileTeam(tx, team.id);
    });
    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(10001);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: 'scim-load-user-1' } });
    const request = new NextRequest('https://capacity.test/api/scim/v2/Groups/scim-load-group-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    const started = performance.now();
    expect((await handle(() => groups(request, 'scim-load-group-1'), request)).status).toBe(204);
    const elapsedMs = performance.now() - started;
    expect(await prisma.teamMember.count({ where: { teamId: team.id } })).toBe(1);
    expect(
      await prisma.teamMember.findFirst({ where: { teamId: team.id, role: 'OWNER' } })
    ).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: before.id } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
    expect((await prisma.service.findUniqueOrThrow({ where: { id: service.id } })).teamId).toBe(
      team.id
    );
    expect(elapsedMs).toBeLessThan(10000);
    process.stdout.write(
      JSON.stringify({
        revokedDirectoryMembers: 10000,
        groupDeleteMs: elapsedMs,
        transactionBudgetMs: 10000,
      }) + '\n'
    );
  }, 120000);
  it('returns bounded SQL drift aggregates for 25 bound 10K-member groups', async () => {
    const connectorId = 'scim-drift-capacity';
    await prisma.scimConnector.upsert({
      where: { id: connectorId },
      create: { id: connectorId, name: 'Drift capacity' },
      update: {},
    });
    await prisma.team.upsert({
      where: { id: connectorId },
      create: { id: connectorId, name: 'Drift capacity team' },
      update: {},
    });
    await prisma.$executeRaw`INSERT INTO "ScimGroup" (id, "connectorId", name, "updatedAt") SELECT 'scim-drift-group-' || i, ${connectorId}, 'Drift capacity ' || i, CURRENT_TIMESTAMP FROM generate_series(1, 25) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimGroupTeamBinding" (id, "groupId", "teamId", "approvedBy") SELECT 'scim-drift-binding-' || i, 'scim-drift-group-' || i, ${connectorId}, 'capacity-certifier' FROM generate_series(1, 25) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId", "userId") SELECT 'scim-drift-group-' || g, 'scim-load-user-' || u FROM generate_series(1, 25) g CROSS JOIN generate_series(1, 10000) u ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "TeamMember" (id, "teamId", "userId", role) SELECT 'scim-drift-member-' || i, ${connectorId}, 'scim-load-user-' || i, 'MEMBER'::"TeamRole" FROM generate_series(1, 10000) i ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "ScimTeamGrant" ("bindingId", "userId", "teamMemberId") SELECT 'scim-drift-binding-1', 'scim-load-user-' || i, 'scim-drift-member-' || i FROM generate_series(1, 10000) i ON CONFLICT DO NOTHING`;
    const databaseDurations: number[] = [];
    let measuring = true;
    prisma.$on('query', query => {
      if (measuring) databaseDurations.push(query.duration);
    });
    const memory = process.memoryUsage().rss;
    const started = performance.now();
    const result = await scimDriftAction({ connectorId, page: 1 });
    const latencyMs = performance.now() - started;
    measuring = false;
    expect(databaseDurations.length).toBeGreaterThan(0);
    const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - memory);
    if ('scimError' in result) throw new Error(result.scimError);
    expect(result).toHaveLength(25);
    expect(
      result.every(
        row =>
          row.missingMembers === 0 &&
          row.unexpectedDirectoryGrants === 0 &&
          row.independentManualMembers === 0
      )
    ).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(16384);
    expect(rssDeltaBytes).toBeLessThan(96 * 1024 * 1024);
    expect(latencyMs).toBeLessThan(10000);
    process.stdout.write(
      JSON.stringify({
        diagnosticBindings: 25,
        directoryMembers: 250000,
        latencyMs,
        databaseQueryMs: databaseDurations.reduce((sum, duration) => sum + duration, 0),
        databaseQueries: databaseDurations.length,
        rssDeltaBytes,
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
        note: 'Action process RSS and roundtrip latency; not database server RSS or production SLA.',
      }) + '\n'
    );
  }, 120000);
});
