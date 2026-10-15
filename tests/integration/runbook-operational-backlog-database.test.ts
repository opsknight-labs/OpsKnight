/* eslint-disable security/detect-non-literal-fs-filename -- Evidence names are fixed literals at all fixture call sites. */
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { testPrisma, resetDatabase } from '../helpers/test-db';
import {
  purgeExpiredRunbookArtifacts,
  ARTIFACT_PURGE_BATCH_SIZE,
} from '@/lib/runbooks/artifact-cleanup';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';
import { getServiceRulePage } from '@/lib/runbooks/service-rule-page';
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
async function workflow() {
  const runbook = await testPrisma.runbook.create({
    data: { name: 'Inventory workflow', slug: crypto.randomUUID() },
  });
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      checksum: 'a'.repeat(64),
      definition: { steps: [] },
    },
  });
  return { runbook, version };
}
async function recordEvidence(name: string, data: unknown) {
  await mkdir('test-results/runbook-engine', { recursive: true });
  await writeFile(
    `test-results/runbook-engine/${name}.json`,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        topology:
          'Isolated PostgreSQL, direct library operations; no physical actions or authenticated fleet capacity claim',
        data,
      },
      null,
      2
    )
  );
}
suite('bounded operational backlog handling', () => {
  beforeEach(resetDatabase, 60_000);
  it('purges one indexed batch from 10000 artifacts while execution recovery progresses', async () => {
    const { runbook, version } = await workflow();
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        status: 'WAITING_AGENT',
        definitionChecksum: version.checksum,
        deadlineAt: new Date(Date.now() - 1000),
        steps: {
          create: {
            stepKey: 'diagnose',
            name: 'Diagnostic',
            sequence: 0,
            type: 'LINUX_DIAGNOSTICS',
            status: 'WAITING_AGENT',
            attempts: { create: { attemptNumber: 1, status: 'PENDING' } },
          },
        },
      },
      include: { steps: { include: { attempts: true } } },
    });
    const attempt = execution.steps[0].attempts[0];
    const createdAt = new Date(Date.now() - 400 * 86_400_000);
    for (let batch = 0; batch < 10; batch++)
      await testPrisma.runbookArtifact.createMany({
        data: Array.from({ length: 1000 }, () => ({
          attemptId: attempt.id,
          content: Buffer.from('x'),
          sha256: 'b'.repeat(64),
          sizeBytes: 1,
          createdAt,
        })),
      });
    await testPrisma.$executeRaw`ANALYZE "RunbookArtifact"`;
    const queryPlan =
      await testPrisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id", "sizeBytes" FROM "RunbookArtifact" WHERE "createdAt" < NOW() - INTERVAL '30 days' ORDER BY "createdAt", "id" LIMIT 100`;
    const started = performance.now();
    const [purged] = await Promise.all([
      purgeExpiredRunbookArtifacts(testPrisma),
      reconcileRunbooks(10),
    ]);
    expect(purged.count).toBe(ARTIFACT_PURGE_BATCH_SIZE);
    expect(purged.hasMore).toBe(true);
    expect(await testPrisma.runbookArtifact.count()).toBe(10000 - ARTIFACT_PURGE_BATCH_SIZE);
    expect(
      (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } })).status
    ).toBe('TIMED_OUT');
    expect(JSON.stringify(queryPlan)).toContain('RunbookArtifact_createdAt_id_idx');
    await recordEvidence('retention-backlog', {
      inventory: 10000,
      purged,
      elapsedMs: performance.now() - started,
      concurrentRecovery: 'TIMED_OUT accurately; history preserved',
      queryPlan,
    });
  }, 60_000);
  it('reaches a newer eligible diagnostic behind 10000 unsafe pool writes without claiming them', async () => {
    const { runbook, version } = await workflow();
    const agent = await testPrisma.runbookAgent.create({
      data: {
        name: 'Claim backlog',
        status: 'ONLINE',
        capabilities: ['RUNBOOK_SYSTEMD', 'RUNBOOK_LINUX_DIAGNOSTICS'],
      },
    });
    const peer = await testPrisma.runbookAgent.create({ data: { name: 'Pool peer' } });
    const pool = await testPrisma.runbookAgentPool.create({
      data: {
        name: 'Ambiguous local hosts',
        mode: 'LOCAL_HOSTS',
        members: { create: [{ agentId: agent.id }, { agentId: peer.id }] },
      },
    });
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        definitionChecksum: version.checksum,
        deadlineAt: new Date(Date.now() + 600_000),
        status: 'RUNNING',
      },
    });
    const old = new Date(Date.now() - 60_000);
    for (let batch = 0; batch < 10; batch++) {
      const ids = Array.from({ length: 1000 }, () => crypto.randomUUID());
      await testPrisma.runbookExecutionStep.createMany({
        data: ids.map((id, index) => ({
          id,
          executionId: execution.id,
          stepKey: id,
          name: 'Unsafe shared write',
          sequence: batch * 1000 + index,
          type: 'SYSTEMD',
          riskClass: 'NON_IDEMPOTENT',
          config: { action: 'restart', unit: 'fixture.service' },
          status: 'WAITING_AGENT',
        })),
      });
      await testPrisma.runbookStepAttempt.createMany({
        data: ids.map(executionStepId => ({
          executionStepId,
          attemptNumber: 1,
          targetAgentPoolId: pool.id,
          claimDeadlineAt: execution.deadlineAt,
          createdAt: old,
        })),
      });
    }
    const captured: Array<{ query: string; params: string }> = [];
    let capturing = true;
    prisma.$on('query', event => {
      if (
        capturing &&
        event.query.includes('RunbookStepAttempt') &&
        event.query.includes('ORDER BY')
      )
        captured.push(event);
    });
    // Record emitted SQL against the ineligible backlog, before adding eligible work.
    expect(await claimAgentAttempt(agent.id, true)).toBeNull();
    capturing = false;
    const eligible = await testPrisma.runbookExecutionStep.create({
      data: {
        executionId: execution.id,
        stepKey: 'eligible',
        name: 'Eligible diagnostic',
        sequence: 10001,
        type: 'LINUX_DIAGNOSTICS',
        riskClass: 'READ_ONLY',
        config: { diagnostic: 'summary' },
        status: 'WAITING_AGENT',
        attempts: {
          create: {
            attemptNumber: 1,
            targetAgentId: agent.id,
            availableAt: old,
            claimDeadlineAt: execution.deadlineAt,
            planDigest: 'b'.repeat(64),
          },
        },
      },
      include: { attempts: true },
    });
    const query = captured[0];
    expect(query).toBeDefined();
    // Inspect a populated pending queue before any mutation consumes the eligible row.
    // Prisma's ORM binds DateTime as timestamp without time zone, while raw Date
    // parameters bind as timestamptz. Preserve the ORM parameter types when replaying.
    let replaySql = query.query;
    const replayParams = (JSON.parse(query.params) as unknown[]).map((value, index) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) return value;
      replaySql = replaySql.replace(/\$(\d+)\b/g, (placeholder, ordinal: string) =>
        Number(ordinal) === index + 1 ? `${placeholder}::timestamp` : placeholder
      );
      return new Date(value).toISOString();
    });
    const queryPlan = await testPrisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.$queryRawUnsafe<
        Array<{ 'QUERY PLAN': Array<{ Plan: { 'Actual Rows': number } }> }>
      >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${replaySql}`, ...replayParams);
    });
    expect(queryPlan[0]['QUERY PLAN'][0].Plan['Actual Rows']).toBe(1);
    const started = performance.now();
    const claimed = await claimAgentAttempt(agent.id, true);
    const elapsedMs = performance.now() - started;
    expect(claimed?.attemptId).toBe(eligible.attempts[0].id);
    expect(
      await testPrisma.runbookStepAttempt.count({
        where: { targetAgentPoolId: pool.id, status: 'PENDING' },
      })
    ).toBe(10000);
    await recordEvidence('claim-ineligible-backlog', {
      ineligibleWrites: 10000,
      eligibleDiagnostics: 1,
      elapsedMs,
      queryPlan,
      physicalActions: 0,
      claimed: claimed?.attemptId,
    });
  }, 60_000);
  it('times out a slow purge independently while recovery uses a single-connection pool', async () => {
    const { runbook, version } = await workflow();
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        definitionChecksum: version.checksum,
        status: 'WAITING_AGENT',
        deadlineAt: new Date(Date.now() - 1000),
        steps: {
          create: {
            stepKey: 'pending',
            name: 'Pending',
            type: 'LINUX_DIAGNOSTICS',
            sequence: 0,
            attempts: {
              create: {
                attemptNumber: 1,
                artifacts: {
                  create: {
                    content: Buffer.from('x'),
                    sizeBytes: 1,
                    sha256: 'c'.repeat(64),
                    createdAt: new Date(0),
                  },
                },
              },
            },
          },
        },
      },
      include: { steps: { include: { attempts: true } } },
    });
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    const maintenance = new PrismaClient({ datasourceUrl: url.toString() });
    const recovery = new PrismaClient({ datasourceUrl: url.toString() });
    await testPrisma.$executeRawUnsafe(
      `CREATE FUNCTION rbe_slow_purge_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3); RETURN OLD; END $$`
    );
    await testPrisma.$executeRawUnsafe(
      `CREATE TRIGGER rbe_slow_purge_fixture BEFORE DELETE ON "RunbookArtifact" FOR EACH ROW EXECUTE FUNCTION rbe_slow_purge_fixture()`
    );
    let purge: Promise<unknown> | undefined;
    try {
      purge = purgeExpiredRunbookArtifacts(maintenance).catch(error => error);
      const deadline = Date.now() + 5000;
      let deleting = false;
      while (Date.now() < deadline) {
        const [row] = await testPrisma.$queryRaw<
          Array<{ busy: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep' AND query LIKE 'DELETE%RunbookArtifact%') AS busy`;
        if (row.busy) {
          deleting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(deleting).toBe(true);
      await recovery.$transaction(tx => reconcileRunbooks(10, tx), { timeout: 2000 });
      expect(
        (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } }))
          .status
      ).toBe('TIMED_OUT');
      expect(await purge).toBeInstanceOf(Error);
      expect(await testPrisma.runbookArtifact.count()).toBe(1);
    } finally {
      await purge;
      await testPrisma.$executeRawUnsafe(
        `DROP TRIGGER rbe_slow_purge_fixture ON "RunbookArtifact"`
      );
      await testPrisma.$executeRawUnsafe(`DROP FUNCTION rbe_slow_purge_fixture()`);
      await Promise.all([maintenance.$disconnect(), recovery.$disconnect()]);
    }
  }, 15_000);
  it('captures query plans and latency for active and archived searches across 20000 service rules', async () => {
    const { runbook } = await workflow();
    const service = await testPrisma.service.create({ data: { name: 'Search inventory' } });
    for (let batch = 0; batch < 20; batch++)
      await testPrisma.serviceAutomationRule.createMany({
        data: Array.from({ length: 1000 }, (_, index) => ({
          serviceId: service.id,
          runbookId: runbook.id,
          name: `Rule ${batch}-${index}${index === 999 ? ' needle' : ''}`,
          detachedAt: batch % 2 ? new Date() : null,
        })),
      });
    await testPrisma.$executeRaw`ANALYZE "ServiceRunbookBinding"`;
    const measured = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    const captured: Array<{ query: string; params: string }> = [];
    measured.$on('query', event => {
      if (event.query.includes('ILIKE')) captured.push(event);
    });
    const results: unknown[] = [];
    try {
      for (const state of ['active', 'archived'] as const)
        for (const search of ['needle', 'not-found', 'Rule', 'Inventory workflow']) {
          const latencies: number[] = [];
          for (let repeat = 0; repeat < 5; repeat++) {
            const started = performance.now();
            const page = await getServiceRulePage(service.id, undefined, measured, {
              state,
              search,
            });
            expect(page.rules.length).toBeLessThanOrEqual(20);
            latencies.push(performance.now() - started);
          }
          const query = captured.at(-1)!;
          // SQL is emitted by Prisma, parameters stay bound; no user-authored SQL.
          const plan = await measured.$queryRawUnsafe(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,
            ...JSON.parse(query.params)
          );
          results.push({ state, search, latenciesMs: latencies, queryPlan: plan });
        }
    } finally {
      await measured.$disconnect();
    }
    await recordEvidence('rule-search-backlog', { inventory: 20000, results });
  }, 60_000);
});
