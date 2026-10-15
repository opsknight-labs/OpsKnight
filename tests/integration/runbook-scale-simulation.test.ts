import { describe, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';
import { testPrisma } from '../helpers/test-db';
const suite =
  process.env.RUNBOOK_SCALE_SIMULATION === 'true' && process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
suite('measured simulated idle Agent claim load (not fleet certification)', () => {
  it('records 10/100/1000 Agent claim latency, database plans and process memory', async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/rbe_engine_test')
      throw new Error('Dedicated simulation database required.');
    const samples: unknown[] = [];
    for (const count of [10, 100, 1000]) {
      const prefix = `scale-${count}-${crypto.randomUUID()}`;
      const ids = Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
      await testPrisma.runbookAgent.createMany({
        data: ids.map(id => ({
          id,
          name: id,
          status: 'ONLINE',
          lastHeartbeatAt: new Date(),
          capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
        })),
      });
      const durations: number[] = [];
      const started = performance.now();
      const cpuStarted = process.cpuUsage();
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(16, count) }, async () => {
          while (cursor < ids.length) {
            const id = ids.at(cursor++);
            if (!id) break;
            const before = performance.now();
            expect(await claimAgentAttempt(id)).toBeNull();
            durations.push(performance.now() - before);
          }
        })
      );
      const elapsedMs = performance.now() - started;
      durations.sort((a, b) => a - b);
      const connections = await testPrisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()`;
      samples.push({
        agents: count,
        concurrency: 16,
        elapsedMs,
        requestsPerSecond: (count / elapsedMs) * 1000,
        p50Ms: durations.at(Math.floor(count * 0.5)),
        p95Ms: durations.at(Math.floor(count * 0.95)),
        p99Ms: durations.at(Math.floor(count * 0.99)),
        cpuMicroseconds: process.cpuUsage(cpuStarted),
        memoryBytes: process.memoryUsage(),
        databaseConnections: Number(connections[0].count),
        outcome: 'No pending work claimed or physical actions executed',
      });
      await testPrisma.runbookAgent.deleteMany({ where: { id: { in: ids } } });
    }
    const queryPlan =
      await testPrisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "RunbookStepAttempt" WHERE status = 'PENDING' AND "availableAt" <= NOW() ORDER BY "createdAt", id LIMIT 50`;
    await mkdir('test-results/runbook-engine', { recursive: true });
    await writeFile(
      'test-results/runbook-engine/scale-simulation.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          topology:
            'Local PostgreSQL, direct library claims, 16 concurrent requests; no network authentication or external mutation workload',
          baselineRevision: 'a278116a0b03c0dac1f5e94c68f88e3814152a2c',
          samples,
          queryPlan,
          limitations: [
            'Not production fleet capacity certification',
            'Only idle/no-work dispatch measured',
            'No HA/network or Kubernetes control-plane load represented',
          ],
        },
        null,
        2
      )
    );
  }, 120000);
});
