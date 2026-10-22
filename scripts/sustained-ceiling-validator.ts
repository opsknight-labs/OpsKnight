import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { runK6 } from './swarm-capacity-tester';

const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts/load-certification/swarm-pgbouncer');

function execSql(sql: string): string {
  const cmd = `docker exec $(docker ps -q -f name=opsknight_opsknight-db) psql -U opsknight -d opsknight_db -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function getDbMetrics() {
  const raw = execSql(`SELECT xact_commit, xact_rollback, numbackends, conflicts, deadlocks FROM pg_stat_database WHERE datname='opsknight_db';`);
  const [commits, rollbacks, backends, conflicts, deadlocks] = raw.split('|').map(Number);
  const incidentCount = Number(execSql(`SELECT count(*) FROM "Incident";`));
  const traceCount = Number(execSql(`SELECT count(*) FROM "AutomationTrace";`));
  const pendingNotifications = Number(execSql(`SELECT count(*) FROM "Notification" WHERE status='PENDING';`));
  return { commits, rollbacks, backends, conflicts, deadlocks, incidentCount, traceCount, pendingNotifications };
}

function getEvaluatorStats(sinceMs: number) {
  try {
    const sinceDate = new Date(sinceMs).toISOString();
    const raw = execSql(`
      SELECT 
        COUNT(*),
        COALESCE(AVG("durationMs"), 0),
        COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "durationMs"), 0),
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0),
        COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "durationMs"), 0),
        COALESCE(COUNT(*) FILTER (WHERE "durationMs" >= 15), 0),
        COALESCE(COUNT(*) FILTER (WHERE "fallbackReason" IS NOT NULL), 0)
      FROM "AutomationTrace"
      WHERE "evaluationAt" >= '${sinceDate}';
    `);
    const [count, avg, p50, p95, p99, timeouts, fallbacks] = raw.split('|').map(Number);
    return { count, avg, p50, p95, p99, timeouts, fallbacks };
  } catch (e) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, timeouts: 0, fallbacks: 0 };
  }
}

async function main() {
  const SUSTAINED_RATE = 10; // Highest passing rate from Phase 1 exploratory tests
  const DURATION = '120s';
  const DURATION_SEC = 120;

  console.log('========================================================================');
  console.log(`Phase 2: Sustainable Ceiling Verification (${SUSTAINED_RATE} RPS for ${DURATION})`);
  console.log('========================================================================\n');

  // 1. Run LIVE-worst candidate (120s)
  console.log(`>>> Step 2A: Running LIVE-worst candidate (${SUSTAINED_RATE} RPS, ${DURATION})...`);
  execSql(`UPDATE "SystemSettings" SET "automationEnabled" = true WHERE id = 'default';`);

  const preCandidateDb = getDbMetrics();
  const candidateSummaryFile = path.join(ARTIFACTS_DIR, 'sustained-candidate-summary.json');
  const candidateStartTime = Date.now();

  const candidateRes = await runK6(
    SUSTAINED_RATE,
    DURATION,
    'live-worst',
    'sustained-candidate',
    candidateSummaryFile
  );
  const postCandidateDb = getDbMetrics();
  const candidateEvalStats = getEvaluatorStats(candidateStartTime);

  const candidateMetrics = candidateRes.summary?.metrics || {};
  const candDuration = candidateMetrics.http_req_duration || {};
  const candFailed = candidateMetrics.http_req_failed || {};
  const candDropped = candidateMetrics.dropped_iterations?.count ?? 0;
  const candReqs = candidateMetrics.http_reqs?.count ?? 0;
  const candAccepted = candidateMetrics['checks{scenario:automation_ingestion}']?.passes ?? 0;

  console.log(`\nCandidate finished: accepted=${candAccepted}, errRate=${((candFailed.value || 0) * 100).toFixed(2)}%, dropped=${candDropped}, p95=${(candDuration['p(95)'] || 0).toFixed(1)}ms`);

  // 2. Run GLOBAL-OFF baseline (120s)
  console.log(`\n>>> Step 2B: Disabling automation (GLOBAL-OFF)...`);
  execSql(`UPDATE "SystemSettings" SET "automationEnabled" = false WHERE id = 'default';`);

  const preBaselineDb = getDbMetrics();
  const baselineSummaryFile = path.join(ARTIFACTS_DIR, 'sustained-baseline-summary.json');
  const baselineStartTime = Date.now();

  console.log(`>>> Step 2C: Running GLOBAL-OFF baseline (${SUSTAINED_RATE} RPS, ${DURATION})...`);
  const baselineRes = await runK6(
    SUSTAINED_RATE,
    DURATION,
    'global-off',
    'sustained-baseline',
    baselineSummaryFile
  );
  const postBaselineDb = getDbMetrics();

  const baselineMetrics = baselineRes.summary?.metrics || {};
  const baseDuration = baselineMetrics.http_req_duration || {};
  const baseFailed = baselineMetrics.http_req_failed || {};
  const baseDropped = baselineMetrics.dropped_iterations?.count ?? 0;
  const baseReqs = baselineMetrics.http_reqs?.count ?? 0;
  const baseAccepted = baselineMetrics['checks{scenario:automation_ingestion}']?.passes ?? 0;

  console.log(`\nBaseline finished: accepted=${baseAccepted}, errRate=${((baseFailed.value || 0) * 100).toFixed(2)}%, dropped=${baseDropped}, p95=${(baseDuration['p(95)'] || 0).toFixed(1)}ms`);

  // Re-enable global automation for subsequent tests
  execSql(`UPDATE "SystemSettings" SET "automationEnabled" = true WHERE id = 'default';`);

  // 3. Compute comparison ratios
  const candP95 = candDuration['p(95)'] || 1;
  const baseP95 = baseDuration['p(95)'] || 1;
  const p95Ratio = Number((candP95 / baseP95).toFixed(2));

  const candP99 = candDuration['p(99)'] || 1;
  const baseP99 = baseDuration['p(99)'] || 1;
  const p99Ratio = Number((candP99 / baseP99).toFixed(2));

  const candP50 = candDuration['p(50)'] || 1;
  const baseP50 = baseDuration['p(50)'] || 1;
  const p50Ratio = Number((candP50 / baseP50).toFixed(2));

  const ratioTargetPassed = p95Ratio <= 1.25 && p99Ratio <= 1.25;

  const resultData = {
    testDate: new Date().toISOString(),
    sustainableRateRps: SUSTAINED_RATE,
    durationSeconds: DURATION_SEC,
    workload: 'LIVE-worst (100 rules, 20 conditions/rule)',
    targetRatioGate: '<= 1.25x',
    p95Ratio,
    p99Ratio,
    p50Ratio,
    ratioTargetPassed,
    candidateLiveWorst: {
      offeredEvents: SUSTAINED_RATE * DURATION_SEC,
      acceptedEvents: candAccepted,
      totalRequests: candReqs,
      errorRate: Number(((candFailed.value || 0) * 100).toFixed(2)),
      droppedIterations: candDropped,
      httpLatency: {
        p50: Number((candDuration['p(50)'] || 0).toFixed(2)),
        p95: Number(candP95.toFixed(2)),
        p99: Number(candP99.toFixed(2)),
        avg: Number((candDuration.avg || 0).toFixed(2)),
      },
      evaluatorLatency: {
        tracesCount: candidateEvalStats.count,
        avgMs: Number(candidateEvalStats.avg.toFixed(2)),
        p50Ms: Number(candidateEvalStats.p50.toFixed(2)),
        p95Ms: Number(candidateEvalStats.p95.toFixed(2)),
        p99Ms: Number(candidateEvalStats.p99.toFixed(2)),
        timeoutsAbove15ms: candidateEvalStats.timeouts,
        fallbacks: candidateEvalStats.fallbacks,
      },
      database: {
        commits: postCandidateDb.commits - preCandidateDb.commits,
        rollbacks: postCandidateDb.rollbacks - preCandidateDb.rollbacks,
        deadlocks: postCandidateDb.deadlocks - preCandidateDb.deadlocks,
      },
    },
    baselineGlobalOff: {
      offeredEvents: SUSTAINED_RATE * DURATION_SEC,
      acceptedEvents: baseAccepted,
      totalRequests: baseReqs,
      errorRate: Number(((baseFailed.value || 0) * 100).toFixed(2)),
      droppedIterations: baseDropped,
      httpLatency: {
        p50: Number((baseDuration['p(50)'] || 0).toFixed(2)),
        p95: Number(baseP95.toFixed(2)),
        p99: Number(baseP99.toFixed(2)),
        avg: Number((baseDuration.avg || 0).toFixed(2)),
      },
      database: {
        commits: postBaselineDb.commits - preBaselineDb.commits,
        rollbacks: postBaselineDb.rollbacks - preBaselineDb.rollbacks,
        deadlocks: postBaselineDb.deadlocks - preBaselineDb.deadlocks,
      },
    },
    limitingComponent: candidateEvalStats.timeouts > 0
      ? 'Rule Evaluation JIT / Event Loop Bound under 100 rules x 20 conditions'
      : 'Web Ingress CPU Saturation',
  };

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'sustained-validation.json'),
    JSON.stringify(resultData, null, 2)
  );

  console.log('\n========================================================================');
  console.log(`Phase 2 Complete. Ratio p95: ${p95Ratio}x, p99: ${p99Ratio}x | Ratio Gate: ${ratioTargetPassed ? 'PASS' : 'EXCEEDED'}`);
  console.log('========================================================================\n');
}

main().catch(err => {
  console.error('Phase 2 failed:', err);
  process.exit(1);
});
