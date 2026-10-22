// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashToken } from '@/lib/scim/security/credentials';
import { users } from '@/lib/scim/lifecycle/users';
import { groups } from '@/lib/scim/lifecycle/groups';
import { handle } from '@/lib/scim/protocol/http';
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
const suite =
  process.env.SCIM_LOAD_TEST === '1' && process.env.VITEST_USE_REAL_DB === '1'
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
        scopes: ['users:read', 'groups:read'],
        createdBy: 'capacity-certifier',
        expiresAt: new Date(Date.now() + 86400000),
      },
      update: { expiresAt: new Date(Date.now() + 86400000) },
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
});
