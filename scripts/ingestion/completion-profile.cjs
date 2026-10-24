/* eslint-disable @typescript-eslint/no-require-imports -- Isolated executable diagnostic. */
/* eslint-disable security/detect-object-injection -- WAL fields come from the fixed PostgreSQL metrics schema. */
/* eslint-disable security/detect-non-literal-fs-filename -- Generated files stay in this diagnostic's owned temporary directory. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prisma = require('../../src/lib/prisma').default;
const { completeProcessingReceipt } = require('../../src/lib/ingestion/postgres');
const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
const database = 'ingestion_test_completion_probe';
const container = 'opsknight-ingestion-cert-db';
const directory = mkdtempSync(path.join(os.tmpdir(), 'ingestion-completion-'));
const remote = `/tmp/${path.basename(directory)}`;
const phases = [];
function sql(statement) {
  return execFileSync(
    docker,
    [
      'exec',
      '-i',
      container,
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'ingestion_certifier',
      '-d',
      database,
    ],
    { input: statement, encoding: 'utf8' }
  ).trim();
}
const receipt = `UPDATE "IngestionReceipt" SET "status"='COMPLETED', "completedAt"=clock_timestamp(),
  "leaseToken"=NULL, "leaseExpiresAt"=NULL, "failureCode"=NULL, "result"='{}'::jsonb
  WHERE "id"=('completion-probe-' || :receipt) AND "status"='PROCESSING'
    AND "leaseToken"='completion-probe' RETURNING "budgetShard", "payloadBytes"`;
function functions() {
  return JSON.parse(
    sql(`SELECT coalesce(json_agg(f),'[]') FROM
    (SELECT funcname, calls, total_time, self_time FROM pg_stat_user_functions
     WHERE funcname LIKE 'opsknight_ingestion_ordering_%') f`)
  );
}
function wal() {
  return JSON.parse(
    sql(`SELECT row_to_json(w) FROM (SELECT wal_records, wal_bytes::float8,
    wal_sync, wal_sync_time, wal_write_time FROM pg_stat_wal) w`)
  );
}
async function measureProcess(args) {
  let pending;
  let samples = 0;
  let errors = 0;
  const waits = new Map();
  const timer = setInterval(() => {
    if (pending) return;
    pending = new Promise(resolve => {
      execFile(
        docker,
        [
          'exec',
          container,
          'psql',
          '-XqAt',
          '-U',
          'ingestion_certifier',
          '-d',
          database,
          '-c',
          `SELECT coalesce(json_agg(s),'[]') FROM (SELECT wait_event_type, wait_event,
          count(*)::int AS connections, count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid))>0)::int AS blocked
          FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
            AND state='active' GROUP BY wait_event_type,wait_event) s`,
        ],
        { encoding: 'utf8' },
        (error, output) => {
          if (error) errors++;
          else {
            try {
              samples++;
              for (const row of JSON.parse(output)) {
                const key = `${row.wait_event_type || 'CPU'}/${row.wait_event || 'running'}`;
                const prior = waits.get(key) || {
                  key,
                  summedConnections: 0,
                  blockedConnections: 0,
                };
                prior.summedConnections += row.connections;
                prior.blockedConnections += row.blocked;
                waits.set(key, prior);
              }
            } catch {
              errors++;
            }
          }
          resolve();
        }
      );
    }).finally(() => {
      pending = undefined;
    });
  }, 100);
  let output;
  try {
    output = await new Promise((resolve, reject) =>
      execFile(docker, args, { encoding: 'utf8' }, (error, stdout) =>
        error ? reject(error) : resolve(stdout)
      )
    );
  } finally {
    clearInterval(timer);
    await pending;
  }
  return { output, waits: [...waits.values()], samples, sampleErrors: errors };
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.port, '55445');
  assert.equal(url.pathname, '/' + database);
  assert.equal(
    execFileSync(
      docker,
      ['buildx', 'history', 'ls', '--filter', 'status=running', '--format', '{{.Ref}}'],
      { encoding: 'utf8' }
    ).trim(),
    '',
    'Stop builds before completion profiling'
  );
  assert.equal(
    sql(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
    AND pid<>pg_backend_pid() AND backend_type='client backend'`),
    '0'
  );
  const settings = JSON.parse(
    sql(`SELECT row_to_json(s) FROM (SELECT
    current_setting('fsync') AS fsync, current_setting('full_page_writes') AS "fullPageWrites",
    current_setting('synchronous_commit') AS "synchronousCommit") s`)
  );
  assert.equal(settings.fsync, 'on');
  assert.equal(settings.fullPageWrites, 'on');
  assert.equal(settings.synchronousCommit, 'on');
  let production;
  prisma.$on('query', event => {
    if (event.query.includes('WITH completed AS')) production = event.query;
  });
  await assert.rejects(
    prisma.$transaction(async tx => {
      await completeProcessingReceipt(
        tx,
        { id: 'absent-probe', token: 'absent-probe' },
        { action: 'triggered' }
      );
    })
  );
  assert.ok(production, 'Production completion query must be captured');
  await prisma.$disconnect();
  const full = production
    .replace(/\$1/g, "'{}'")
    .replace(/\$2/g, "('completion-probe-' || :receipt)")
    .replace(/\$3/g, "'completion-probe'");
  assert.ok(!/\$\d/.test(full), 'Completion parameters changed; update diagnostic explicitly');
  execFileSync(docker, ['exec', container, 'mkdir', remote]);
  // ABBA order avoids attributing one cold-first run to the trigger. This
  // baseline disables only the new update trigger on this dedicated clone;
  // it is an isolation experiment, not a deployable alternative.
  for (const clients of [1, 16]) {
    for (const shape of ['distributed', 'hot-budget']) {
      for (const variant of [
        'full-frontier',
        'full-no-frontier',
        'full-no-frontier',
        'full-frontier',
        'receipt-only',
        'budget-only',
      ]) {
        const iterations = 64;
        const count = clients * iterations;
        sql(`ALTER TABLE "IngestionReceipt" ENABLE TRIGGER "IngestionReceipt_ordering_update";
          TRUNCATE "IngestionOrderingHead", "IngestionReceipt" CASCADE;
          UPDATE "IngestionBudget" SET pending=0, bytes=0;
          INSERT INTO "IngestionReceipt" (id,"serviceId","integrationId","partitionKey","idempotencyKey",
            "contentHash","budgetShard","payloadBytes",envelope,status,"leaseToken","leaseExpiresAt","orderingKeys")
          SELECT 'completion-probe-'||g,'probe','probe','probe-'||g,'completion-probe-'||g,'probe',
            ${shape === 'hot-budget' ? '0' : 'g%64'},1,'{}','PROCESSING','completion-probe',
            now()+interval '1 hour',ARRAY['canonical:'||g,'legacy:'||g]
          FROM generate_series(0,${count - 1}) g;
          UPDATE "IngestionBudget" b SET pending=x.n,bytes=x.n FROM
            (SELECT "budgetShard",count(*) n FROM "IngestionReceipt" GROUP BY "budgetShard") x
            WHERE b.shard=x."budgetShard";
          ANALYZE "IngestionReceipt", "IngestionOrderingHead", "IngestionOrderingLink";`);
        if (variant === 'full-no-frontier')
          sql('ALTER TABLE "IngestionReceipt" DISABLE TRIGGER "IngestionReceipt_ordering_update"');
        const statement =
          variant === 'receipt-only'
            ? receipt
            : variant === 'budget-only'
              ? `UPDATE "IngestionBudget" SET pending=pending-1, bytes=bytes-1
            WHERE shard=${shape === 'hot-budget' ? '0' : '(:receipt % 64)'}`
              : full;
        const planSql = statement.replaceAll(':receipt', '0');
        const plan = JSON.parse(
          sql(`BEGIN; SET LOCAL jit=off;
          EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${planSql}; ROLLBACK;`)
        )[0];
        const before = new Map(functions().map(row => [row.funcname, row]));
        writeFileSync(
          path.join(directory, 'work.sql'),
          `\\set receipt :client_id * ${iterations} + :counter
\\set counter :counter + 1
BEGIN;
${statement};
COMMIT;\n`
        );
        execFileSync(docker, [
          'cp',
          path.join(directory, 'work.sql'),
          `${container}:${remote}/work.sql`,
        ]);
        const beforeWal = wal();
        const measured = await measureProcess([
          'exec',
          '-e',
          'PGOPTIONS=-c jit=off -c track_functions=all -c track_wal_io_timing=on',
          container,
          'pgbench',
          '-r',
          '-n',
          '-M',
          'prepared',
          '-c',
          String(clients),
          '-j',
          String(Math.min(clients, 4)),
          '-t',
          String(iterations),
          '-D',
          'counter=0',
          '-f',
          `${remote}/work.sql`,
          '-U',
          'ingestion_certifier',
          database,
        ]);
        const { output } = measured;
        const afterWal = wal();
        const walDelta = Object.fromEntries(
          Object.entries(afterWal).map(([key, value]) => [key, value - beforeWal[key]])
        );
        const completed = Number(output.match(/transactions actually processed: (\d+)/)?.[1]);
        assert.equal(completed, count);
        const functionTimes = functions().map(row => ({
          name: row.funcname,
          calls: row.calls - (before.get(row.funcname)?.calls || 0),
          totalMs: row.total_time - (before.get(row.funcname)?.total_time || 0),
          selfMs: row.self_time - (before.get(row.funcname)?.self_time || 0),
        }));
        const [state] = JSON.parse(
          sql(`SELECT json_agg(s) FROM (SELECT
          (SELECT count(*) FROM "IngestionReceipt" WHERE status='COMPLETED') AS completed,
          (SELECT sum(pending) FROM "IngestionBudget") AS pending,
          (SELECT count(*) FROM "IngestionOrderingHead") AS heads) s`)
        );
        if (variant.startsWith('full-')) {
          assert.equal(state.completed, count);
          assert.equal(state.pending, 0);
        }
        if (variant === 'full-frontier') assert.equal(state.heads, 0);
        const commandLatencies = [...output.matchAll(/^\s*([\d.]+)\s+(\d+)\s+(.+)$/gm)].map(
          match => ({
            meanMs: Number(match[1]),
            failures: Number(match[2]),
            operation: match[3].trim().split(/\s/)[0],
          })
        );
        const phase = {
          commandLatencies,
          walDelta,
          waits: measured.waits,
          samples: measured.samples,
          sampleErrors: measured.sampleErrors,
          clients,
          shape,
          variant,
          transactions: completed,
          tpsIncludingCommit: Number(output.match(/tps = ([\d.]+)/)?.[1]),
          meanLatencyIncludingCommitMs: Number(output.match(/latency average = ([\d.]+)/)?.[1]),
          explainExecutionMs: plan['Execution Time'],
          triggerTimings: plan.Triggers || [],
          functionTimes,
          state,
        };
        phases.push(phase);
        console.log(JSON.stringify(phase));
      }
    }
  }
  const evidence = {
    detachDefinitionSha256: createHash('sha256')
      .update(
        sql("SELECT pg_get_functiondef('opsknight_ingestion_ordering_detach(text)'::regprocedure)")
      )
      .digest('hex'),
    measuredAt: new Date().toISOString(),
    certified: false,
    settings,
    scope:
      'Completion-only pgbench over owned container socket, tiny synthetic receipts/two unique identities, no incident engine or admission. ABBA trigger isolation on disposable clone; disabling triggers is NOT a production optimization. Explicit BEGIN/completion/COMMIT command timings include socket/protocol overhead. EXPLAIN uses a separate cold session and excludes commit. WAL deltas include other databases on the owned test instance. Sampling adds diagnostic overhead. No application capacity claim.',
    phases,
  };
  writeFileSync(
    process.argv[2] || 'plans/event-ingestion/local-completion-isolation.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      sql('ALTER TABLE "IngestionReceipt" ENABLE TRIGGER "IngestionReceipt_ordering_update"');
    } finally {
      await prisma.$disconnect();
      execFileSync(docker, ['exec', container, 'rm', '-rf', remote]);
      rmSync(directory, { recursive: true, force: true });
    }
  });
