import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const migration = readFileSync(
  'prisma/migrations/20260919000000_service_objective_foundation/migration.sql',
  'utf8'
);

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql.slice(index, index + 2) === '$$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      index += 1;
      continue;
    }
    const character = sql.charAt(index);
    if (character === ';' && !inDollarQuote) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

describeIfRealDB('service objective PostgreSQL migration', () => {
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('reconstructs legacy version lineages without deleting legacy history', async () => {
    const schema = `slo_migration_${process.pid}_${Date.now()}`;
    try {
      await testPrisma.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          await tx.$executeRawUnsafe('CREATE TABLE "Service" ("id" TEXT PRIMARY KEY)');
          await tx.$executeRawUnsafe('CREATE TABLE "cron_scheduler_state" ("id" TEXT PRIMARY KEY)');
          await tx.$executeRawUnsafe(`
            CREATE TABLE "SLADefinition" (
              "id" TEXT PRIMARY KEY,
              "name" TEXT NOT NULL,
              "description" TEXT,
              "targetAckTime" INTEGER,
              "targetResolveTime" INTEGER,
              "serviceId" TEXT REFERENCES "Service"("id"),
              "priority" TEXT,
              "target" DOUBLE PRECISION NOT NULL,
              "window" TEXT NOT NULL,
              "metricType" TEXT NOT NULL,
              "version" INTEGER NOT NULL,
              "activeFrom" TIMESTAMP(3) NOT NULL,
              "activeTo" TIMESTAMP(3),
              "createdAt" TIMESTAMP(3) NOT NULL,
              "updatedAt" TIMESTAMP(3) NOT NULL
            )
          `);
          await tx.$executeRawUnsafe(`
            CREATE TABLE "SLASnapshot" (
              "id" TEXT PRIMARY KEY,
              "slaDefinitionId" TEXT NOT NULL REFERENCES "SLADefinition"("id"),
              "date" TIMESTAMP(3) NOT NULL
            )
          `);
          await tx.$executeRawUnsafe(`INSERT INTO "Service" VALUES ('service-1')`);
          await tx.$executeRawUnsafe(`INSERT INTO "cron_scheduler_state" VALUES ('scheduler')`);
          await tx.$executeRawUnsafe(`
            INSERT INTO "SLADefinition" (
              "id", "name", "serviceId", "target", "window", "metricType", "version",
              "activeFrom", "activeTo", "createdAt", "updatedAt", "targetAckTime", "targetResolveTime"
            ) VALUES
              ('legacy-v1', 'Availability v1', 'service-1', 99.0, '30d', 'AVAILABILITY', 1,
               '2026-01-01', '2026-02-01', '2026-01-01', '2026-01-01', NULL, NULL),
              ('legacy-v2', 'Availability v2', 'service-1', 99.5, '30d', 'AVAILABILITY', 2,
               '2026-02-01', '2026-03-01', '2026-02-01', '2026-02-01', NULL, NULL),
              ('legacy-v3', 'Availability v3', 'service-1', 99.9, '30d', 'AVAILABILITY', 3,
               '2026-03-01', NULL, '2026-03-01', '2026-03-01', NULL, NULL),
              ('legacy-new-v1', 'Availability recreated v1', 'service-1', 99.5, '30d', 'AVAILABILITY', 1,
               '2026-04-01', '2026-05-01', '2026-04-01', '2026-04-01', NULL, NULL),
              ('legacy-new-v2', 'Availability recreated v2', 'service-1', 99.9, '30d', 'AVAILABILITY', 2,
               '2026-05-01', NULL, '2026-05-01', '2026-05-01', NULL, NULL),
              ('incident-only', 'Incident SLA', 'service-1', 95, '30d', 'UPTIME', 1,
               '2026-01-01', NULL, '2026-01-01', '2026-01-01', 5, 30)
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "SLASnapshot" VALUES
              ('snapshot-v1', 'legacy-v1', '2026-01-15'),
              ('snapshot-v2', 'legacy-v2', '2026-02-15'),
              ('snapshot-new-v1', 'legacy-new-v1', '2026-04-15'),
              ('snapshot-incident', 'incident-only', '2026-01-15')
          `);

          for (const statement of splitSqlStatements(migration)) {
            await tx.$executeRawUnsafe(statement);
          }

          const objectives = await tx.$queryRawUnsafe<
            Array<{
              lineageId: string;
              legacySlaDefinitionId: string;
              version: number;
              activeTo: Date | null;
            }>
          >(`
            SELECT "lineageId", "legacySlaDefinitionId", "version", "activeTo"
            FROM "ServiceObjective"
            ORDER BY "activeFrom"
          `);
          expect(objectives).toHaveLength(5);
          expect(new Set(objectives.map(row => row.lineageId)).size).toBe(2);
          expect(objectives.map(row => row.version)).toEqual([1, 2, 3, 1, 2]);
          expect(objectives.map(row => row.legacySlaDefinitionId)).toEqual([
            'legacy-v1',
            'legacy-v2',
            'legacy-v3',
            'legacy-new-v1',
            'legacy-new-v2',
          ]);
          expect(objectives.filter(row => row.activeTo === null)).toHaveLength(1);
          expect(objectives[0]?.lineageId).toBe(objectives[2]?.lineageId);
          expect(objectives[3]?.lineageId).toBe(objectives[4]?.lineageId);
          expect(objectives[2]?.activeTo).toEqual(new Date('2026-04-01T00:00:00.000Z'));

          await tx.$executeRawUnsafe('SAVEPOINT active_objective_conflict');
          let conflictRejected = false;
          try {
            await tx.$executeRawUnsafe(`
              INSERT INTO "ServiceObjective" (
                "id", "lineageId", "serviceId", "name", "metricType", "target",
                "comparator", "windowType", "version", "activeFrom", "updatedAt"
              ) VALUES (
                'conflicting-active', 'different-lineage', 'service-1', 'Conflict',
                'AVAILABILITY', 99.9, 'GREATER_THAN_OR_EQUAL', 'THIRTY_DAYS', 1,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )
            `);
          } catch {
            conflictRejected = true;
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT active_objective_conflict');
          }
          expect(conflictRejected).toBe(true);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT active_objective_conflict');

          const expectDatabaseRejection = async (name: string, sql: string) => {
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            let rejected = false;
            try {
              await tx.$executeRawUnsafe(sql);
            } catch {
              rejected = true;
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
            }
            expect(rejected).toBe(true);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
          };
          await expectDatabaseRejection(
            'immutable_update',
            `UPDATE "ServiceObjective" SET "target" = 1 WHERE "legacySlaDefinitionId" = 'legacy-v1'`
          );
          await expectDatabaseRejection(
            'immutable_delete',
            `DELETE FROM "ServiceObjective" WHERE "legacySlaDefinitionId" = 'legacy-v1'`
          );
          await expectDatabaseRejection('service_scope_restrict', `DELETE FROM "Service" WHERE "id" = 'service-1'`);

          const [{ definitions, snapshots, incidentObjectives }] = await tx.$queryRawUnsafe<
            Array<{ definitions: bigint; snapshots: bigint; incidentObjectives: bigint }>
          >(`
            SELECT
              (SELECT COUNT(*) FROM "SLADefinition") AS definitions,
              (SELECT COUNT(*) FROM "SLASnapshot") AS snapshots,
              (SELECT COUNT(*) FROM "ServiceObjective"
                WHERE "legacySlaDefinitionId" = 'incident-only') AS "incidentObjectives"
          `);
          expect(Number(definitions)).toBe(6);
          expect(Number(snapshots)).toBe(4);
          expect(Number(incidentObjectives)).toBe(0);
        },
        { maxWait: 10_000, timeout: 30_000 }
      );
    } finally {
      await testPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
