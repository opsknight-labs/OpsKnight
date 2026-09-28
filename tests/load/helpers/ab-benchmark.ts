import { PrismaClient } from '@prisma/client';
import { runReadCommittedTransaction } from '../../src/lib/db-utils';

export interface BenchmarkMetrics {
  profile: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  peakActiveConnections: number;
  peakWaitingConnections: number;
  poolTimeoutCount: number;
  durationMs: number;
}

export interface ProfileConfig {
  name: string;
  txTimeoutMs: number;
  txMaxWaitMs: number;
  txMaxAttempts: number;
}

export const PROFILE_A_DEFAULT: ProfileConfig = {
  name: 'Profile A (Existing Defaults)',
  txTimeoutMs: 10_000,
  txMaxWaitMs: 2_000,
  txMaxAttempts: 3,
};

export const PROFILE_B_TUNED: ProfileConfig = {
  name: 'Profile B (Tuned Pool/Retries)',
  txTimeoutMs: 15_000,
  txMaxWaitMs: 10_000,
  txMaxAttempts: 5,
};

/**
 * Execute concurrent synthetic transaction contention workload against PostgreSQL
 */
export async function runContentionWorkload(
  prisma: PrismaClient,
  profile: ProfileConfig,
  iterations = 100,
  concurrency = 25
): Promise<BenchmarkMetrics> {
  process.env.OPSKNIGHT_TX_TIMEOUT_MS = String(profile.txTimeoutMs);
  process.env.OPSKNIGHT_TX_MAX_WAIT_MS = String(profile.txMaxWaitMs);
  process.env.OPSKNIGHT_TX_MAX_ATTEMPTS = String(profile.txMaxAttempts);

  const latencies: number[] = [];
  let successful = 0;
  let failed = 0;
  let poolTimeouts = 0;

  const start = Date.now();

  const worker = async () => {
    for (let i = 0; i < iterations / concurrency; i++) {
      const t0 = Date.now();
      try {
        await runReadCommittedTransaction(async tx => {
          // Read service record and update state
          await tx.$queryRaw`SELECT 1`;
        });
        successful++;
      } catch (err: unknown) {
        failed++;
        const e = err as { code?: string; message?: string };
        if (e?.code === 'P2024' || e?.message?.includes('timed out')) {
          poolTimeouts++;
        }
      } finally {
        latencies.push(Date.now() - t0);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = Date.now() - start;

  latencies.sort((a, b) => a - b);
  const p50Ms = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99Ms = latencies[Math.floor(latencies.length * 0.99)] || 0;

  // Query connection activity
  const connStats = await prisma.$queryRaw<Array<{ active: bigint; waiting: bigint }>>`
    SELECT
      COUNT(*) FILTER (WHERE state = 'active')::bigint AS active,
      COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::bigint AS waiting
    FROM pg_stat_activity
    WHERE datname = current_database();
  `;

  const active = Number(connStats[0]?.active || 0);
  const waiting = Number(connStats[0]?.waiting || 0);

  return {
    profile: profile.name,
    totalTransactions: latencies.length,
    successfulTransactions: successful,
    failedTransactions: failed,
    p50Ms,
    p95Ms,
    p99Ms,
    peakActiveConnections: active,
    peakWaitingConnections: waiting,
    poolTimeoutCount: poolTimeouts,
    durationMs,
  };
}

export function formatComparisonMarkdown(results: BenchmarkMetrics[]): string {
  let md = '| Profile | Total Tx | Success | Fail | p50 (ms) | p95 (ms) | p99 (ms) | Peak Conns | Pool Timeouts |\n';
  md += '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n';
  for (const r of results) {
    md += `| ${r.profile} | ${r.totalTransactions} | ${r.successfulTransactions} | ${r.failedTransactions} | ${r.p50Ms} | ${r.p95Ms} | ${r.p99Ms} | ${r.peakActiveConnections} | ${r.poolTimeoutCount} |\n`;
  }
  return md;
}
