import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts/load-certification/swarm-pgbouncer');
const BASE_URL = 'http://127.0.0.1:3300';
const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'seed-manifest.json');

function execSql(sql: string): string {
  const cmd = `docker exec $(docker ps -q -f name=opsknight_opsknight-db) psql -U opsknight -d opsknight_db -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function getDbMetrics() {
  const raw = execSql(`SELECT xact_commit, xact_rollback, numbackends, conflicts, deadlocks FROM pg_stat_database WHERE datname='opsknight_db';`);
  const [commits, rollbacks, backends, conflicts, deadlocks] = raw.split('|').map(Number);
  const incidentCount = Number(execSql(`SELECT count(*) FROM "Incident";`));
  const traceCount = Number(execSql(`SELECT count(*) FROM "AutomationTrace";`));
  const pendingNotificationCount = Number(execSql(`SELECT count(*) FROM "Notification" WHERE status='PENDING';`));
  const deliveredNotificationCount = Number(execSql(`SELECT count(*) FROM "Notification" WHERE status='DELIVERED';`));
  const failedNotificationCount = Number(execSql(`SELECT count(*) FROM "Notification" WHERE status='FAILED';`));

  return {
    commits,
    rollbacks,
    backends,
    conflicts,
    deadlocks,
    incidentCount,
    traceCount,
    pendingNotificationCount,
    deliveredNotificationCount,
    failedNotificationCount,
    timestamp: Date.now(),
  };
}

function getPgBouncerMetrics() {
  try {
    const raw = execSync(
      `docker exec $(docker ps -q -f name=opsknight_opsknight-pgbouncer | head -n 1) env PGPASSWORD=opsknight_secure_password_change_me psql -h 127.0.0.1 -p 6432 -U opsknight -d pgbouncer -t -A -c "SHOW POOLS;"`,
      { encoding: 'utf8' }
    ).trim();
    // database|user|cl_active|cl_waiting|cl_active_cancel_req|cl_waiting_cancel_req|sv_active|sv_active_cancel|sv_being_canceled|sv_idle|sv_used|sv_tested|sv_login|maxwait|maxwait_us|pool_mode|load_balance_hosts
    const line = raw.split('\n').find(l => l.startsWith('opsknight_db|opsknight|'));
    if (line) {
      const parts = line.split('|');
      return {
        cl_active: Number(parts[2]),
        cl_waiting: Number(parts[3]),
        sv_active: Number(parts[6]),
        sv_idle: Number(parts[9]),
        sv_used: Number(parts[10]),
        maxwait: Number(parts[13]),
      };
    }
  } catch (e) {
    // ignore
  }
  return { cl_active: 0, cl_waiting: 0, sv_active: 0, sv_idle: 0, sv_used: 0, maxwait: 0 };
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

interface RoundConfig {
  round: number;
  rate: number;
  duration: string;
  durationSec: number;
}

const ROUNDS: RoundConfig[] = [
  { round: 1, rate: 20, duration: '30s', durationSec: 30 },
  { round: 2, rate: 50, duration: '30s', durationSec: 30 },
  { round: 3, rate: 100, duration: '45s', durationSec: 45 },
  { round: 4, rate: 200, duration: '45s', durationSec: 45 },
  { round: 5, rate: 400, duration: '45s', durationSec: 45 },
  { round: 6, rate: 800, duration: '45s', durationSec: 45 },
  { round: 7, rate: 1200, duration: '45s', durationSec: 45 },
  { round: 8, rate: 1600, duration: '45s', durationSec: 45 },
];

export async function runK6(
  rate: number,
  duration: string,
  profile: string,
  runId: string,
  summaryExportPath: string
): Promise<{ stdout: string; summary: any; exitCode: number }> {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      BASE_URL,
      LOAD_SEED_MANIFEST: MANIFEST_PATH,
      AUTOMATION_RPS: String(rate),
      AUTOMATION_DURATION: duration,
      AUTOMATION_LOAD_PROFILE: profile,
      AUTOMATION_RUN_ID: runId,
      AUTOMATION_PREALLOC_VUS: String(Math.max(300, Math.min(rate * 2, 800))),
      AUTOMATION_MAX_VUS: String(Math.max(500, Math.min(rate * 3, 1200))),
    };

    const args = [
      'run',
      '--summary-export',
      summaryExportPath,
      path.join(REPO_ROOT, 'tests/load/scenarios/automation.js'),
    ];

    console.log(`[k6] Starting ${runId}: rate=${rate} RPS, duration=${duration}, profile=${profile}`);
    const proc = spawn('k6', args, { env, cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (s.includes('running') || s.includes('iters/s')) {
        const lastLine = s.trim().split('\n').pop();
        if (lastLine) console.log(`  [k6 status] ${lastLine}`);
      }
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (exitCode) => {
      let summary = null;
      if (fs.existsSync(summaryExportPath)) {
        try {
          summary = JSON.parse(fs.readFileSync(summaryExportPath, 'utf8'));
        } catch (_) {}
      }
      resolve({ stdout, summary, exitCode: exitCode ?? 0 });
    });
  });
}

async function main() {
  console.log('========================================================================');
  console.log('OpsKnight — Docker Swarm + PgBouncer Enterprise Capacity Test');
  console.log(`Commit: 5943389a6 | Base URL: ${BASE_URL}`);
  console.log('========================================================================\n');

  const rampResults: any[] = [];
  let breakingPoint: any = null;
  let highestSafeRate = 0;

  for (const cfg of ROUNDS) {
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`>>> Round ${cfg.round}: Offered Rate ${cfg.rate} RPS, Duration ${cfg.duration}`);
    console.log(`------------------------------------------------------------------------`);

    const preDb = getDbMetrics();
    const prePgb = getPgBouncerMetrics();
    const summaryFile = path.join(ARTIFACTS_DIR, `round-${cfg.round}-summary.json`);

    const startTime = Date.now();
    const { summary, exitCode } = await runK6(
      cfg.rate,
      cfg.duration,
      'live-worst',
      `round-${cfg.round}`,
      summaryFile
    );
    const durationRealSec = (Date.now() - startTime) / 1000;

    const postDb = getDbMetrics();
    const postPgb = getPgBouncerMetrics();
    const evalStats = getEvaluatorStats(startTime);

    const httpMetrics = summary?.metrics?.http_reqs || {};
    const failedMetrics = summary?.metrics?.http_req_failed || {};
    const durationMetrics = summary?.metrics?.http_req_duration || {};
    const acceptedEvents =
      summary?.metrics?.automation_accepted_events?.count ??
      summary?.metrics?.['checks{scenario:automation_ingestion}']?.passes ??
      0;
    const droppedIters = summary?.metrics?.dropped_iterations?.count ?? 0;

    const offeredEvents = cfg.rate * cfg.durationSec;
    const totalRequests = httpMetrics.count ?? 0;
    const errorRate = failedMetrics.value ?? 0;
    const newIncidents = postDb.incidentCount - preDb.incidentCount;
    const deadlocks = postDb.deadlocks - preDb.deadlocks;
    const tps = (postDb.commits - preDb.commits) / durationRealSec;

    const roundData = {
      round: cfg.round,
      offeredRps: cfg.rate,
      durationSec: cfg.durationSec,
      offeredEvents,
      acceptedEvents,
      persistedIncidents: newIncidents,
      httpReqsTotal: totalRequests,
      httpReqsPerSec: totalRequests / durationRealSec,
      errorRate: Number((errorRate * 100).toFixed(2)),
      droppedIterations: droppedIters,
      httpLatency: {
        p50: Number((durationMetrics['p(50)'] ?? 0).toFixed(2)),
        p95: Number((durationMetrics['p(95)'] ?? 0).toFixed(2)),
        p99: Number((durationMetrics['p(99)'] ?? 0).toFixed(2)),
        avg: Number((durationMetrics.avg ?? 0).toFixed(2)),
        max: Number((durationMetrics.max ?? 0).toFixed(2)),
      },
      evaluatorLatency: {
        count: evalStats.count,
        avgMs: Number(evalStats.avg.toFixed(2)),
        p50Ms: Number(evalStats.p50.toFixed(2)),
        p95Ms: Number(evalStats.p95.toFixed(2)),
        p99Ms: Number(evalStats.p99.toFixed(2)),
        timeoutsAbove15ms: evalStats.timeouts,
        fallbacks: evalStats.fallbacks,
      },
      database: {
        tps: Number(tps.toFixed(1)),
        commits: postDb.commits - preDb.commits,
        rollbacks: postDb.rollbacks - preDb.rollbacks,
        deadlocks,
        activeBackends: postDb.backends,
      },
      pgbouncer: {
        cl_active: postPgb.cl_active,
        cl_waiting: postPgb.cl_waiting,
        sv_active: postPgb.sv_active,
        sv_idle: postPgb.sv_idle,
        maxwaitMs: postPgb.maxwait,
      },
      notifications: {
        pending: postDb.pendingNotificationCount,
        delivered: postDb.deliveredNotificationCount - preDb.deliveredNotificationCount,
        failed: postDb.failedNotificationCount - preDb.failedNotificationCount,
      },
      exitCode,
      passed: false,
      failureReasons: [] as string[],
    };

    // Evaluate breaking criteria
    if (errorRate >= 0.01) {
      roundData.failureReasons.push(`HTTP error rate ${(errorRate * 100).toFixed(2)}% >= 1.00%`);
    }
    if (droppedIters > 0) {
      roundData.failureReasons.push(`Dropped iterations: ${droppedIters}`);
    }
    if (evalStats.timeouts > 0) {
      roundData.failureReasons.push(`Automation evaluation timeouts (>=15ms): ${evalStats.timeouts}`);
    }
    if (deadlocks > 0) {
      roundData.failureReasons.push(`Database deadlocks encountered: ${deadlocks}`);
    }
    if (roundData.failureReasons.length === 0) {
      roundData.passed = true;
      highestSafeRate = cfg.rate;
      console.log(`  >>> Round ${cfg.round} PASS at ${cfg.rate} RPS (p95=${roundData.httpLatency.p95}ms, errorRate=${roundData.errorRate}%, evalP95=${roundData.evaluatorLatency.p95Ms}ms)`);
    } else {
      console.log(`  >>> Round ${cfg.round} BREAKING POINT at ${cfg.rate} RPS! Reasons: ${roundData.failureReasons.join('; ')}`);
      breakingPoint = {
        breakingRound: cfg.round,
        breakingRateRps: cfg.rate,
        highestSafeRateRps: highestSafeRate,
        limitingComponent: roundData.failureReasons[0].includes('Dropped')
          ? 'Load Generator / Concurrency Capacity'
          : roundData.failureReasons[0].includes('HTTP error')
          ? 'Web Tier / Connection Saturation'
          : roundData.failureReasons[0].includes('evaluation timeouts')
          ? 'Rule Engine Evaluation Bound'
          : 'Database Concurrency Lock Contention',
        reasons: roundData.failureReasons,
        telemetryAtBreak: roundData,
      };
      rampResults.push(roundData);
      break;
    }

    rampResults.push(roundData);
  }

  // Save stress ramp and breaking point
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'stress-ramp.json'),
    JSON.stringify({ rounds: rampResults, highestSafeRateRps: highestSafeRate }, null, 2)
  );

  if (breakingPoint) {
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'breaking-point.json'),
      JSON.stringify(breakingPoint, null, 2)
    );
  } else {
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'breaking-point.json'),
      JSON.stringify(
        {
          breakingRound: null,
          highestSafeRateRps: highestSafeRate,
          status: 'NO_BREAKING_POINT_REACHED_WITHIN_MAX_TEST_TIER',
        },
        null,
        2
      )
    );
  }

  console.log('\n========================================================================');
  console.log(`Phase 1 Complete. Highest Safe Sustained Rate: ${highestSafeRate} RPS`);
  console.log('========================================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during swarm capacity test:', err);
    process.exit(1);
  });
}
