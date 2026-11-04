import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const migration = readFileSync(
  'prisma/migrations/20261105000000_mcp_best_in_class/migration.sql',
  'utf8'
);

function splitSqlStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

type Tx = Parameters<Parameters<typeof testPrisma.$transaction>[0]>[0];

async function rejects(tx: Tx, name: string, sql: string): Promise<boolean> {
  await tx.$executeRawUnsafe(`SAVEPOINT "${name}"`);
  try {
    await tx.$executeRawUnsafe(sql);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
    return false;
  } catch {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`);
    return true;
  }
}

/** The pre-migration shape of every table the migration touches, reduced to what it reads. */
const LEGACY_TABLES = [
  `CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "tokenVersion" INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE "McpClient" ("id" TEXT PRIMARY KEY)`,
  `CREATE TABLE "McpGrant" (
    "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL,
    "userTokenVersion" INTEGER NOT NULL)`,
  `CREATE TABLE "McpToken" ("id" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL)`,
  `CREATE TABLE "McpAuthorizationCode" ("hash" TEXT PRIMARY KEY, "grantId" TEXT NOT NULL)`,
  `CREATE TABLE "McpPolicy" ("id" TEXT PRIMARY KEY DEFAULT 'default')`,
  `CREATE TABLE "McpConsentRequest" ("id" TEXT PRIMARY KEY, "state" TEXT NOT NULL)`,
  `CREATE TABLE "McpOperationApproval" (
    "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3), "rejectedAt" TIMESTAMP(3))`,
  `ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_status"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'COMMITTED', 'FAILED'))`,
  `ALTER TABLE "McpOperationApproval" ADD CONSTRAINT "mcp_operation_approval_state"
    CHECK (
      ("status" = 'PENDING' AND "reviewedAt" IS NULL AND "rejectedAt" IS NULL) OR
      ("status" = 'REJECTED' AND "rejectedAt" IS NOT NULL) OR
      ("status" IN ('APPROVED', 'EXECUTING', 'COMMITTED', 'FAILED') AND "reviewedAt" IS NOT NULL))`,
  `CREATE TABLE "RunbookPreviewAuthorization" ("id" TEXT PRIMARY KEY, "rejectedAt" TIMESTAMP(3))`,
];

describeIfRealDB('MCP best-in-class migration', () => {
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('backfills revocation versions so current grants stay valid and stale ones stay stale', async () => {
    const schema = `mcp_bic_migration_${process.pid}_${Date.now()}`;
    try {
      await testPrisma.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          for (const statement of LEGACY_TABLES) await tx.$executeRawUnsafe(statement);

          await tx.$executeRawUnsafe(
            `INSERT INTO "User" VALUES ('u-current', 3), ('u-bumped', 5), ('u-new', 0)`
          );
          await tx.$executeRawUnsafe(`INSERT INTO "McpClient" VALUES ('c1')`);
          // g-valid pins the user's current tokenVersion; g-stale was signed out by a later bump.
          await tx.$executeRawUnsafe(`
            INSERT INTO "McpGrant" VALUES
              ('g-valid', 'c1', 'u-current', 3),
              ('g-stale', 'c1', 'u-bumped', 4),
              ('g-zero', 'c1', 'u-new', 0)
          `);
          await tx.$executeRawUnsafe(`INSERT INTO "McpPolicy" ("id") VALUES ('default')`);
          await tx.$executeRawUnsafe(`INSERT INTO "McpConsentRequest" VALUES ('cr1', 'abc')`);
          await tx.$executeRawUnsafe(`INSERT INTO "McpOperationApproval" ("id") VALUES ('a1')`);

          for (const statement of splitSqlStatements(migration)) {
            await tx.$executeRawUnsafe(statement);
          }

          const pins = await tx.$queryRawUnsafe<
            Array<{ id: string; pinned: number; current: number; matches: boolean }>
          >(`
            SELECT g."id", g."userRevocationVersion" AS pinned,
              u."mcpRevocationVersion" AS current,
              g."userRevocationVersion" = u."mcpRevocationVersion" AS matches
            FROM "McpGrant" g JOIN "User" u ON u."id" = g."userId" ORDER BY g."id"
          `);
          expect(pins).toEqual([
            { id: 'g-stale', pinned: 4, current: 5, matches: false },
            { id: 'g-valid', pinned: 3, current: 3, matches: true },
            { id: 'g-zero', pinned: 0, current: 0, matches: true },
          ]);

          const [policy] = await tx.$queryRawUnsafe<Array<Record<string, number>>>(`
            SELECT "approvalTtlMinutes", "approvalCommitWindowMinutes",
              "refreshReuseGraceSeconds", "policyRevision" FROM "McpPolicy"
          `);
          expect(policy).toEqual({
            approvalTtlMinutes: 240,
            approvalCommitWindowMinutes: 30,
            refreshReuseGraceSeconds: 30,
            policyRevision: 0,
          });
          expect(
            await rejects(tx, 'ttl_low', `UPDATE "McpPolicy" SET "approvalTtlMinutes" = 14`)
          ).toBe(true);
          expect(
            await rejects(tx, 'ttl_high', `UPDATE "McpPolicy" SET "approvalTtlMinutes" = 1441`)
          ).toBe(true);
          expect(
            await rejects(tx, 'ttl_ok', `UPDATE "McpPolicy" SET "approvalTtlMinutes" = 1440`)
          ).toBe(false);

          // OAuth state is optional now.
          expect(
            await rejects(tx, 'state_null', `INSERT INTO "McpConsentRequest" VALUES ('cr2', NULL)`)
          ).toBe(false);

          // The sweep can mark lapsed approvals EXPIRED.
          expect(
            await rejects(
              tx,
              'expired',
              `UPDATE "McpOperationApproval" SET "status" = 'EXPIRED' WHERE "id" = 'a1'`
            )
          ).toBe(false);
          expect(
            await rejects(
              tx,
              'unknown_status',
              `UPDATE "McpOperationApproval" SET "status" = 'BOGUS' WHERE "id" = 'a1'`
            )
          ).toBe(true);

          // A rejecter needs a rejection time; a reason is capped at 500 characters.
          for (const table of ['McpOperationApproval', 'RunbookPreviewAuthorization']) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "${table}" ("id") VALUES ('r-${table}') ON CONFLICT DO NOTHING`
            );
            expect(
              await rejects(
                tx,
                `rejecter_${table}`,
                `UPDATE "${table}" SET "rejectedById" = 'u-current' WHERE "id" = 'r-${table}'`
              )
            ).toBe(true);
            expect(
              await rejects(
                tx,
                `reason_${table}`,
                `UPDATE "${table}" SET "decisionReason" = repeat('x', 501) WHERE "id" = 'r-${table}'`
              )
            ).toBe(true);
            expect(
              await rejects(
                tx,
                `reason_ok_${table}`,
                `UPDATE "${table}" SET "decisionReason" = repeat('x', 500) WHERE "id" = 'r-${table}'`
              )
            ).toBe(false);
          }

          const indexes = await tx.$queryRawUnsafe<Array<{ indexname: string }>>(
            `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE '%_idx'
             ORDER BY indexname`,
            schema
          );
          expect(indexes.map(row => row.indexname)).toEqual([
            'McpAuthorizationCode_grantId_idx',
            'McpGrant_clientId_idx',
            'McpToken_grantId_idx',
          ]);

          throw new Error('rollback');
        },
        { timeout: 20_000 }
      );
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'rollback') throw error;
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it('stores SYSTEM in-app notifications on the migrated database', async () => {
    const user = await testPrisma.user.create({
      data: { name: 'Reviewer', email: `mcp-system-${Date.now()}@example.com` },
    });
    try {
      await createInAppNotifications(
        {
          userIds: [user.id],
          type: 'SYSTEM',
          title: 'Approval requested',
          message: 'An assistant is waiting for your review.',
          entityType: 'MCP_APPROVAL',
          entityId: 'approval-1',
          dedupeKey: 'mcp-approval:approval-1',
        },
        testPrisma
      );
      const rows = await testPrisma.inAppNotification.findMany({ where: { userId: user.id } });
      expect(rows.map(row => row.type)).toEqual(['SYSTEM']);
    } finally {
      await testPrisma.inAppNotification.deleteMany({ where: { userId: user.id } });
      await testPrisma.user.delete({ where: { id: user.id } });
    }
  });
});
