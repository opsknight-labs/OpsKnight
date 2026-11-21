/**
 * Opt-in conversion of "Alert" to monthly RANGE partitions on "createdAt". Never run by migrations.
 *
 *   tsx scripts/partition-alerts.ts                       # dry run: preflight and the full SQL plan
 *   tsx scripts/partition-alerts.ts --apply --step=prepare  # partitioned shadow table + mirror trigger
 *   tsx scripts/partition-alerts.ts --apply --step=copy [--after=<createdAt>,<id>] [--batch=1000]
 *   tsx scripts/partition-alerts.ts --apply --step=swap     # short ACCESS EXCLUSIVE rename
 *   tsx scripts/partition-alerts.ts --apply --step=finalize # stop mirroring to the old table
 *   tsx scripts/partition-alerts.ts --apply --step=rollback # after swap, before finalize
 *
 * See docs/v2.3.0/operate/data/alert-partitioning.md.
 */
import prisma from '../src/lib/prisma';
import { getPrismaPoolWaitCount } from '../src/lib/prisma-pool-pressure';
import { getCriticalBacklogLagMs } from '../src/lib/intelligence/jobs/backpressure';
import {
  COPY_BATCH_SQL,
  COPY_START,
  PARTITIONED,
  UNPARTITIONED,
  planConversion,
  type ForeignKeyDef,
  type IndexDef,
} from '../src/lib/alerts/partitioning';

const STEPS = ['prepare', 'copy', 'swap', 'finalize', 'rollback'] as const;
type Step = (typeof STEPS)[number];
const arg = (name: string) =>
  process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function exists(table: string) {
  const [row] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS ok`;
  return Boolean(row?.ok);
}

/** Reads the live "Alert" (or, after swap, the old table) shape the plan is generated from. */
async function inspect(table: string) {
  const indexes = await prisma.$queryRaw<IndexDef[]>`
    SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
           i.indisunique AS unique, i.indisprimary AS primary
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = to_regclass(${`"${table}"`})`;
  const ownForeignKeys = await prisma.$queryRaw<ForeignKeyDef[]>`
    SELECT conname AS name, conrelid::regclass::text AS table, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype = 'f' AND conrelid = to_regclass(${`"${table}"`})`;
  const referencingForeignKeys = await prisma.$queryRaw<ForeignKeyDef[]>`
    SELECT conname AS name, trim(both '"' from conrelid::regclass::text) AS table,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE contype = 'f' AND confrelid = to_regclass('"Alert"')
      AND conrelid <> to_regclass('"Alert"')`;
  const [{ oldest } = { oldest: null }] = await prisma.$queryRaw<Array<{ oldest: Date | null }>>`
    SELECT min("createdAt") AS oldest FROM "Alert"`;
  return { indexes, ownForeignKeys, referencingForeignKeys, oldest };
}

async function underPressure() {
  const waiting = await getPrismaPoolWaitCount();
  return (waiting !== null && waiting > 0) || (await getCriticalBacklogLagMs()) > 15_000;
}

async function runAll(statements: string[], transactional: boolean) {
  if (transactional)
    await prisma.$transaction(statements.map(sql => prisma.$executeRawUnsafe(sql)));
  else for (const sql of statements) await prisma.$executeRawUnsafe(sql);
}

async function copy() {
  const batch = Number(arg('batch') ?? 1000);
  if (!Number.isInteger(batch) || batch < 1 || batch > 10_000)
    throw new Error('--batch must be between 1 and 10000');
  const after = arg('after');
  let cursor: { createdAt: string; id: string } = COPY_START;
  if (after) {
    const comma = after.indexOf(',');
    cursor = { createdAt: after.slice(0, comma), id: after.slice(comma + 1) };
  }
  let copied = 0;
  for (;;) {
    let waits = 0;
    while (await underPressure()) {
      if (++waits > 30) {
        console.log(JSON.stringify({ step: 'copy', paused: true, copied, resume: cursor }));
        console.error('Copy paused to protect paging and database capacity. Rerun with --after.');
        process.exitCode = 2;
        return;
      }
      await sleep(10_000);
    }
    const [row] = await prisma.$queryRawUnsafe<
      Array<{ rows: number; createdAt: Date; id: string }>
    >(COPY_BATCH_SQL, cursor.createdAt, cursor.id, batch);
    if (!row || row.rows === 0) break;
    copied += row.rows;
    cursor = { createdAt: row.createdAt.toISOString(), id: row.id };
    if (copied % (batch * 50) < batch)
      console.log(JSON.stringify({ step: 'copy', copied, resume: cursor }));
  }
  console.log(JSON.stringify({ step: 'copy', done: true, copied }));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const step = (arg('step') ?? 'prepare') as Step;
  if (!STEPS.includes(step)) throw new Error(`--step must be one of ${STEPS.join(', ')}`);
  const monthsAhead = Number(arg('months-ahead') ?? 3);

  const swapped = await exists(UNPARTITIONED);
  const [{ partitioned } = { partitioned: false }] = await prisma.$queryRaw<
    Array<{ partitioned: boolean }>
  >`SELECT EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = to_regclass('"Alert"')) AS partitioned`;
  if (partitioned && !swapped) {
    console.log(JSON.stringify({ state: 'finalized', note: 'Alert is already partitioned' }));
    return;
  }
  const shape = await inspect(swapped ? UNPARTITIONED : 'Alert');
  if (swapped)
    // After swap the old table's indexes carry the _unpart suffix; restore the live names for the plan.
    shape.indexes = shape.indexes.map(index => ({
      ...index,
      name: index.primary ? 'Alert_pkey' : index.name.replace(/_unpart$/, ''),
    }));
  const plan = planConversion({ ...shape, now: new Date(), monthsAhead });

  if (!apply) {
    const [{ total } = { total: 0 }] = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM "Alert"`;
    const [{ mismatched } = { mismatched: 0 }] = await prisma.$queryRaw<
      Array<{ mismatched: number }>
    >`SELECT count(*)::int AS mismatched FROM "AlertFingerprint" f JOIN "Alert" a ON a.id = f."alertId"
      WHERE a."createdAt" <> f."alertCreatedAt"`;
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          state: swapped ? 'swapped' : (await exists(PARTITIONED)) ? 'prepared' : 'unpartitioned',
          alerts: total,
          fingerprintCreatedAtMismatches: mismatched,
          plan,
        },
        null,
        2
      )
    );
    return;
  }

  if (step === 'prepare') {
    if (swapped || (await exists(PARTITIONED))) throw new Error('Already prepared');
    await runAll(plan.prepare, true);
  } else if (step === 'copy') {
    if (!(await exists(PARTITIONED)) || swapped) throw new Error('Run --step=prepare first');
    await copy();
  } else if (step === 'swap') {
    if (swapped) throw new Error('Already swapped');
    const [{ missing } = { missing: 1 }] = await prisma.$queryRaw<Array<{ missing: number }>>`
      SELECT ((SELECT count(*) FROM "Alert") - (SELECT count(*) FROM "Alert_partitioned"))::int AS missing`;
    if (missing !== 0)
      throw new Error(`Copy incomplete (${missing} rows differ); rerun --step=copy first`);
    await runAll(plan.swap, true);
  } else if (step === 'finalize') {
    if (!swapped) throw new Error('Nothing to finalize; run --step=swap first');
    await runAll(plan.finalize, false);
  } else {
    if (!swapped) throw new Error('Nothing to roll back');
    await runAll(plan.rollback, true);
  }
  console.log(JSON.stringify({ mode: 'applied', step }));
}

main()
  .catch(error => {
    // Planner and guard errors are fixed text; anything else is reported without connection details.
    console.error(
      error instanceof Error && !/postgres|password|@/i.test(error.message)
        ? error.message
        : 'Alert partitioning stopped. Check database connectivity, capacity and arguments.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
