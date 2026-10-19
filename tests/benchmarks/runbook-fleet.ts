/** Explicit local reference benchmark; never part of the ordinary CI test discovery. */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateRunbookAgentMetadata } from '../../src/lib/runbooks/pool-commands';
import prisma from '../../src/lib/prisma';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '55442' ||
    url.pathname !== '/api_completion_test' ||
    process.env.API_FLEET_BENCHMARK !== '1'
  )
    throw new Error('Explicit opt-in to the owned local reference database is required.');
  const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let queries = 0;
  let advisoryStatementMs = 0;
  db.$on('query', event => {
    queries++;
    if (event.query.includes('pg_advisory_xact_lock(')) advisoryStatementMs += event.duration;
  });
  const runs: object[] = [];
  const prefix = `fleet-benchmark-${randomUUID()}`;
  try {
    const actor = await db.user.create({
      data: { name: prefix, email: `${prefix}@example.test`, role: 'ADMIN', status: 'ACTIVE' },
    });
    for (const [size, poolCount] of [
      [100, 100],
      [1000, 1000],
      [5000, 1000],
    ] as const) {
      const tag = `${prefix}-${size}`;
      await db.runbookAgent.createMany({
        data: Array.from({ length: size }, (_, i) => ({
          id: `${tag}-${i}`,
          name: tag,
          labels: { benchmarkEnv: 'staging', benchmarkScope: tag },
          createdById: actor.id,
        })),
      });
      await db.runbookAgentPool.createMany({
        data: Array.from({ length: poolCount }, (_, i) => ({
          id: `${tag}-pool-${i}`,
          name: tag,
          matchLabels: { benchmarkEnv: i % 2 ? 'production' : 'staging', benchmarkScope: tag },
          createdById: actor.id,
        })),
      });
      const samples: object[] = [];
      for (let iteration = 0; iteration < 6; iteration++) {
        const before = await db.$queryRaw<
          Array<{ lsn: string }>
        >`SELECT pg_current_wal_insert_lsn()::text AS lsn`;
        const revisionBefore = await db.runbookAgentPool.aggregate({
          where: { name: tag },
          _sum: { revision: true },
        });
        queries = 0;
        advisoryStatementMs = 0;
        const started = performance.now();
        await db.$transaction(
          tx =>
            updateRunbookAgentMetadata(
              `${tag}-0`,
              {
                labels: {
                  benchmarkEnv: iteration % 2 ? 'staging' : 'production',
                  benchmarkScope: tag,
                },
              },
              actor.id,
              { client: tx }
            ),
          { timeout: 10000 }
        );
        const elapsedMs = performance.now() - started;
        const queryCount = queries;
        const advisoryLockStatementMs = advisoryStatementMs;
        const revisionAfter = await db.runbookAgentPool.aggregate({
          where: { name: tag },
          _sum: { revision: true },
        });
        const wal = await db.$queryRaw<
          Array<{ bytes: bigint }>
        >`SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(), ${before[0].lsn}::pg_lsn)::bigint AS bytes`;
        const membershipCount = await db.runbookAgentPoolMember.count({
          where: { agentId: `${tag}-0` },
        });
        const untouchedMembershipCount = await db.runbookAgentPoolMember.count({
          where: { agentId: { startsWith: `${tag}-`, not: `${tag}-0` } },
        });
        if (membershipCount !== poolCount / 2 || untouchedMembershipCount !== 0)
          throw new Error('Targeted membership invariant failed.');
        samples.push({
          elapsedMs,
          queryCount,
          advisoryLockStatementMs,
          revisionDelta: (revisionAfter._sum.revision ?? 0) - (revisionBefore._sum.revision ?? 0),
          walBytes: Number(wal[0].bytes),
          membershipCount,
        });
      }
      const concurrentWaves: object[] = [];
      // Materialize the eight managed identities before timing contention.
      // Otherwise a failed first edit followed by a successful no-op can
      // legitimately leave an untouched fixture without dynamic memberships.
      for (let writer = 0; writer < 8; writer++)
        await updateRunbookAgentMetadata(
          `${tag}-${writer + 1}`,
          { labels: { benchmarkEnv: 'production', benchmarkScope: tag } },
          actor.id
        );
      for (let wave = 0; wave < 3; wave++) {
        const started = performance.now();
        // Use the real command-owned Serializable transaction and production
        // retry budget. Do not hide contention by extending transaction limits.
        const writers = await Promise.all(
          Array.from({ length: 8 }, async (_, writer) => {
            const writerStarted = performance.now();
            try {
              await updateRunbookAgentMetadata(
                `${tag}-${writer + 1}`,
                {
                  labels: {
                    benchmarkEnv: wave % 2 ? 'production' : 'staging',
                    benchmarkScope: tag,
                  },
                },
                actor.id
              );
              return { writer, elapsedMs: performance.now() - writerStarted, success: true };
            } catch (error) {
              return {
                writer,
                elapsedMs: performance.now() - writerStarted,
                success: false,
                code: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
              };
            }
          })
        );
        for (let writer = 0; writer < 8; writer++) {
          const id = `${tag}-${writer + 1}`;
          const agent = await db.runbookAgent.findUniqueOrThrow({ where: { id } });
          const labels = agent.labels as { benchmarkEnv: string };
          const memberships = await db.runbookAgentPoolMember.findMany({
            where: { agentId: id },
            select: { pool: { select: { matchLabels: true } } },
          });
          if (
            memberships.length !== poolCount / 2 ||
            memberships.some(
              member =>
                (member.pool.matchLabels as { benchmarkEnv: string }).benchmarkEnv !==
                labels.benchmarkEnv
            )
          )
            throw new Error('Concurrent writer membership invariant failed.');
        }
        concurrentWaves.push({
          writers: 8,
          elapsedMs: performance.now() - started,
          results: writers,
        });
      }
      runs.push({ agents: size, pools: poolCount, samples, concurrentWaves });
      await db.runbookAgentPool.deleteMany({ where: { name: tag } });
      await db.runbookAgent.deleteMany({ where: { name: tag } });
    }
    await db.user.delete({ where: { id: actor.id } });
    const report = {
      sourceParent: '22e554be2',
      createdAt: new Date().toISOString(),
      environment: 'Shared local PostgreSQL 16/Docker VM; reference performance only',
      measurementNotes: [
        'Query count covers the complete transaction and canonical audit.',
        'WAL positions are cluster-wide and may include co-resident writes.',
        'Every iteration changes one Agent and checks membership in half the configured pools; unrelated Agent membership remains untouched.',
        'Advisory-lock statement duration includes execution and waiting at millisecond resolution; it is not isolated lock-wait attribution. Production load/HA remain pending.',
        'Concurrent waves use eight command-owned Serializable writers, including the unchanged production retry budget. Per-writer failures are retained, not retried by the harness.',
      ],
      runs,
    };
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-fleet-benchmark-'));
    const destination = join(directory, 'results.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed filename in a private mkdtemp directory, never caller-controlled
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(`Completed 100/1000/5000-Agent reference benchmark: ${destination}`);
  } finally {
    await db.runbookAgentPool.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.runbookAgent.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { name: prefix } });
    await db.$disconnect();
    await prisma.$disconnect();
  }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Fleet benchmark failed');
  process.exitCode = 1;
});
