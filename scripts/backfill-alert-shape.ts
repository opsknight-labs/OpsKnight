import prisma from '../src/lib/prisma';
import { backfillAlertShapes, type AlertBackfillCursor } from '../src/lib/alerts/backfill';
import { getPrismaPoolWaitCount } from '../src/lib/prisma-pool-pressure';
import { getCriticalBacklogLagMs } from '../src/lib/intelligence/jobs/backpressure';

async function main() {
  const apply = process.argv.includes('--apply');
  const raw = process.argv.find(value => value.startsWith('--max-rows='))?.slice(11);
  const maxRows = raw === undefined ? 100000 : Number(raw);
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1000000)
    throw new Error('--max-rows must be between 1 and 1000000');
  if (!apply) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        pending: await prisma.alert.count({ where: { severity: null } }),
      })
    );
    return;
  }
  let after: AlertBackfillCursor | undefined;
  let scanned = 0,
    updated = 0,
    skipped = 0;
  while (scanned < maxRows) {
    const waiting = await getPrismaPoolWaitCount();
    if ((waiting !== null && waiting > 0) || (await getCriticalBacklogLagMs()) > 15000)
      throw new Error(
        'Backfill paused to protect database capacity and paging. Rerun after recovery.'
      );
    const batch = await backfillAlertShapes({ limit: Math.min(250, maxRows - scanned), after });
    scanned += batch.scanned;
    updated += batch.updated;
    skipped += batch.skipped;
    if (batch.done || !batch.after) break;
    after = batch.after;
  }
  console.log(
    JSON.stringify({
      mode: 'applied',
      scanned,
      updated,
      skipped,
      pending: await prisma.alert.count({ where: { severity: null } }),
    })
  );
}
main()
  .catch(() => {
    // Fixed error text: never print a datasource, payload, connection secret or source identifier.
    console.error(
      'Alert metadata backfill stopped. Check database connectivity, capacity and arguments; rerun to resume.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
