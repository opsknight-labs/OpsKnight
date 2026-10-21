/** Explicit, isolated reference measurement; excluded from ordinary test discovery. */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { secretUsageQuery, type SecretUsage } from '../../src/lib/runbooks/secret-usage';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '55442' ||
    url.pathname !== '/api_completion_test' ||
    process.env.API_SECRET_USAGE_BENCHMARK !== '1'
  )
    throw new Error('Explicit opt-in to the owned reference database is required.');
  const db = new PrismaClient();
  const prefix = `secret-usage-${randomUUID()}`;
  const epoch = new Date('2026-01-01T00:00:00Z');
  const common = `secret://${prefix}-common`;
  const rare = `secret://${prefix}-rare`;
  let runbookId: string | undefined;
  let serviceId: string | undefined;
  try {
    const service = await db.service.create({ data: { name: prefix } });
    serviceId = service.id;
    const runbook = await db.runbook.create({ data: { name: prefix, slug: prefix } });
    runbookId = runbook.id;
    const version = await db.runbookVersion.create({
      data: {
        runbookId,
        version: 1,
        state: 'DRAFT',
        checksum: 'a'.repeat(64),
        definition: { steps: [] },
      },
    });
    const reference = (i: number) => (i === 99999 ? rare : i % 10 ? common : 'unrelated-reference');
    for (let offset = 0; offset < 100000; offset += 1000)
      await db.runbookExecution.createMany({
        data: Array.from({ length: 1000 }, (_, n) => ({
          id: `${prefix}-execution-${offset + n}`,
          runbookId: runbook.id,
          runbookVersionId: version.id,
          definitionChecksum: version.checksum,
          deadlineAt: new Date(Date.now() + 86400000),
          status: 'SUCCEEDED' as const,
          inputValues: { token: reference(offset + n) },
          createdAt: new Date(epoch.getTime() + offset + n),
        })),
      });
    await db.serviceAutomationRule.createMany({
      data: Array.from({ length: 1000 }, (_, n) => ({
        serviceId: service.id,
        runbookId: runbook.id,
        runbookVersionId: version.id,
        enabled: false,
        inputValues: { token: n === 999 ? rare : common },
        createdAt: new Date(epoch.getTime() + n),
      })),
    });
    await db.runbookInput.createMany({
      data: Array.from({ length: 1000 }, (_, n) => ({
        runbookVersionId: version.id,
        key: `key${n}`,
        label: `Input ${n}`,
        type: 'SECRET_REF' as const,
        defaultValue: n === 999 ? rare : common,
        createdAt: new Date(epoch.getTime() + n),
      })),
    });
    await db.$executeRaw`ANALYZE "RunbookExecution"`;
    await db.$executeRaw`ANALYZE "ServiceRunbookBinding"`;
    await db.$executeRaw`ANALYZE "RunbookInput"`;
    const cases = [
      { name: 'common-first', reference: common, cursor: null },
      {
        name: 'common-deep',
        reference: common,
        cursor: {
          createdAt: new Date(epoch.getTime() + 10000).toISOString(),
          id: `execution:${prefix}-execution-10000`,
        },
      },
      { name: 'rare-first', reference: rare, cursor: null },
      {
        name: 'rare-deep',
        reference: rare,
        cursor: {
          createdAt: new Date(epoch.getTime() + 10000).toISOString(),
          id: `execution:${prefix}-execution-10000`,
        },
      },
    ];
    const plans: object[] = [];
    for (const item of cases) {
      const query = secretUsageQuery(item.reference, 100, item.cursor);
      const plan = await db.$transaction(
        async tx => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
          return tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        },
        { timeout: 5000, maxWait: 1000 }
      );
      plans.push({ name: item.name, plan });
    }
    const concurrent = await Promise.all(
      Array.from({ length: 16 }, async (_, i) => {
        const item = cases[i % cases.length];
        const started = performance.now();
        try {
          const rows = await db.$transaction(
            async tx => {
              await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
              return tx.$queryRaw<SecretUsage[]>(
                secretUsageQuery(item.reference, 100, item.cursor)
              );
            },
            { timeout: 5000, maxWait: 1000 }
          );
          if (rows.some(row => row.runbookId !== runbook.id))
            throw new Error('Fixture isolation failed.');
          let previous: Date | undefined;
          for (const row of rows) {
            if (previous && row.createdAt > previous) throw new Error('Usage ordering failed.');
            previous = row.createdAt;
          }
          return {
            name: item.name,
            elapsedMs: performance.now() - started,
            rows: rows.length,
            success: true,
          };
        } catch (error) {
          return {
            name: item.name,
            elapsedMs: performance.now() - started,
            success: false,
            code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'UNKNOWN',
          };
        }
      })
    );
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-secret-usage-'));
    const destination = join(directory, 'results.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed basename in private generated directory
    await writeFile(
      destination,
      JSON.stringify(
        {
          sourceParent: '22e554be2',
          createdAt: new Date().toISOString(),
          environment:
            'Shared local PostgreSQL 16; reference only, not production load or HA certification',
          fixtures: { executions: 100000, rules: 1000, defaults: 1000 },
          statementTimeoutMs: 2000,
          plans,
          concurrent,
        },
        null,
        2
      ) + '\n',
      { mode: 0o600, flag: 'wx' }
    );
    console.log(`Secret usage reference results: ${destination}`);
  } finally {
    if (runbookId) {
      await db.runbookExecution.deleteMany({ where: { runbookId } });
      await db.serviceAutomationRule.deleteMany({ where: { runbookId } });
      await db.runbookVersion.deleteMany({ where: { runbookId } });
      await db.runbook.delete({ where: { id: runbookId } });
    }
    if (serviceId) await db.service.delete({ where: { id: serviceId } });
    await db.$disconnect();
  }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Secret usage benchmark failed');
  process.exitCode = 1;
});
