/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS diagnostic shared by executable fixture harnesses. */
/* eslint-disable security/detect-object-injection -- Counter field names come from the fixed local PostgreSQL metrics schema, never request input. */
const { createHash } = require('node:crypto');

// Diagnostic snapshots only. Never reset cluster statistics or retain SQL text,
// parameters, client addresses, database usernames, or query result payloads.
module.exports = async function startDatabaseProfile(prisma) {
  const statements = () => prisma.$queryRaw`
    SELECT query, queryid::text AS id, calls::double precision AS calls,
      total_exec_time::double precision AS "executionMs", rows::double precision AS rows,
      shared_blks_hit::double precision AS "blocksHit", shared_blks_read::double precision AS "blocksRead",
      shared_blks_dirtied::double precision AS "blocksDirtied", temp_blks_written::double precision AS "tempBlocksWritten",
      wal_bytes::double precision AS "walBytes"
    FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  `;
  const counters = async () => {
    const [value] = await prisma.$queryRaw`
      SELECT xact_commit::double precision AS commits, xact_rollback::double precision AS rollbacks,
        deadlocks::double precision AS deadlocks, temp_bytes::double precision AS "tempBytes",
        tup_inserted::double precision AS inserts, tup_updated::double precision AS updates,
        tup_deleted::double precision AS deletes,
        (SELECT wal_bytes::double precision FROM pg_stat_wal) AS "clusterWalBytes"
      FROM pg_stat_database WHERE datname = current_database()
    `;
    return value;
  };
  const baseline = new Map((await statements()).map(row => [row.id, row]));
  const before = await counters();
  const started = performance.now();
  let inFlight;
  let samples = 0;
  let errors = 0;
  const waits = new Map();
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = prisma.$queryRaw`
      SELECT state, COALESCE(wait_event_type, 'CPU') AS type,
        COALESCE(wait_event, 'running') AS event, COUNT(*)::int AS count
      FROM pg_stat_activity WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND pid <> pg_backend_pid() GROUP BY state, wait_event_type, wait_event
    `
      .then(rows => {
        samples++;
        for (const row of rows) {
          const key = `${row.state}/${row.type}/${row.event}`;
          const value = waits.get(key) || {
            state: row.state,
            type: row.type,
            event: row.event,
            summedConnections: 0,
            maxConnections: 0,
          };
          value.summedConnections += row.count;
          value.maxConnections = Math.max(value.maxConnections, row.count);
          waits.set(key, value);
        }
      })
      .catch(() => {
        errors++;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }, 1000);
  timer.unref();
  return async function finishDatabaseProfile() {
    clearInterval(timer);
    await inFlight;
    const after = await counters();
    const elapsedMs = performance.now() - started;
    const models = [
      'IngestionQuota',
      'SystemConfig',
      'IngestionReceipt',
      'IngestionBudget',
      'IngestionBatch',
      'ServiceAutomationConfig',
      'SystemSettings',
      'IncidentEvent',
      'Incident',
      'Alert',
      'BackgroundJob',
      'Service',
    ];
    const rows = (await statements())
      .map(row => {
        const prior = baseline.get(row.id);
        const delta = key => Math.max(0, row[key] - (prior?.[key] || 0));
        const calls = delta('calls');
        return {
          fingerprint: createHash('sha256').update(row.query).digest('hex'),
          operation:
            row.query
              .trim()
              .match(/^[A-Za-z]+/)?.[0]
              .toUpperCase() || 'OTHER',
          model: models.find(model => row.query.includes(`"${model}"`)) || 'other',
          calls,
          executionMs: delta('executionMs'),
          meanExecutionMs: calls ? delta('executionMs') / calls : 0,
          rows: delta('rows'),
          blocksHit: delta('blocksHit'),
          blocksRead: delta('blocksRead'),
          blocksDirtied: delta('blocksDirtied'),
          tempBlocksWritten: delta('tempBlocksWritten'),
          walBytes: delta('walBytes'),
        };
      })
      .filter(row => row.calls > 0);
    const deltaCounters = Object.fromEntries(
      Object.entries(after).map(([key, value]) => [key, Math.max(0, value - before[key])])
    );
    return {
      scope:
        'Owned local test database; PostgreSQL execution statistics exclude client/pool/network time. Cluster WAL includes all databases on this owned test instance.',
      elapsedMs,
      counters: deltaCounters,
      totalQueryCalls: rows.reduce((sum, row) => sum + row.calls, 0),
      totalDatabaseExecutionMs: rows.reduce((sum, row) => sum + row.executionMs, 0),
      topQueriesByExecutionTime: rows.sort((a, b) => b.executionMs - a.executionMs).slice(0, 30),
      activitySamples: samples,
      activitySampleErrors: errors,
      waits: [...waits.values()].map(row => ({
        ...row,
        averageConnectionsPerSample: samples ? row.summedConnections / samples : 0,
      })),
    };
  };
};
