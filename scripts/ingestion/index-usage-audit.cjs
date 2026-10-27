/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL diagnostic uses the shared TypeScript runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Operator-selected local evidence path. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;

(async () => {
  assert.equal(new URL(process.env.DATABASE_URL).port, '55445');
  const indexes = await prisma.$queryRaw`
    SELECT stats.relname AS table, stats.indexrelname AS index,
      stats.idx_scan::double precision AS scans,
      stats.idx_tup_read::double precision AS "tuplesRead",
      stats.idx_tup_fetch::double precision AS "tuplesFetched",
      pg_relation_size(stats.indexrelid)::double precision AS bytes,
      definition.indisunique AS unique, definition.indisprimary AS primary,
      definition.indpred IS NOT NULL AS partial,
      definition.indnkeyatts::int AS "keyColumns"
    FROM pg_stat_user_indexes stats JOIN pg_index definition ON definition.indexrelid=stats.indexrelid
    WHERE stats.schemaname='public' AND stats.relname IN ('Incident','Alert','BackgroundJob')
    ORDER BY stats.relname, stats.indexrelname
  `;
  const tables = await prisma.$queryRaw`
    SELECT relname AS table, n_live_tup::double precision AS "estimatedLiveRows",
      n_dead_tup::double precision AS "estimatedDeadRows", n_tup_ins::double precision AS inserts,
      n_tup_upd::double precision AS updates, n_tup_hot_upd::double precision AS "hotUpdates",
      pg_total_relation_size(relid)::double precision AS "totalBytes"
    FROM pg_stat_user_tables WHERE schemaname='public' AND relname IN ('Incident','Alert','BackgroundJob')
    ORDER BY relname
  `;
  const [statistics] = await prisma.$queryRaw`
    SELECT stats_reset AS "countersSince" FROM pg_stat_database WHERE datname=current_database()
  `;
  const evidence = {
    measuredAt: new Date().toISOString(),
    certifiedEnterprise: false,
    scope:
      'Read-only owned fixture counters since their last reset; no statistics reset or indexes changed. Zero scans in a short fixture do not establish redundancy. Representative UI/report/SLA/cleanup plans and write/WAL comparisons are required before removal.',
    removalDecision: 'No Incident indexes removed; fixture-only usage cannot establish redundancy.',
    statistics,
    tables,
    indexes,
  };
  writeFileSync(
    process.env.INGESTION_INDEX_AUDIT_EVIDENCE ||
      'plans/event-ingestion/local-index-usage-audit.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
})()
  .catch(() => {
    console.error('Owned index audit failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
