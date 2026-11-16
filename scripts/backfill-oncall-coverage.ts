/**
 * Backfills OnCallCoverageDay for the last 30 finished days of every schedule, so load and fairness have
 * history from day one. Idempotent and resumable: captured days are skipped, and `--cursor <scheduleId>`
 * restarts after a given schedule. The lane keeps the snapshot current afterwards.
 *
 *   npm run backfill:oncall-coverage -- [--batch 25] [--cursor <scheduleId>]
 */
import { backfillOnCallCoverage, COVERAGE_BACKFILL_DAYS } from '@/lib/oncall-load/store';
import prisma from '@/lib/prisma';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const batchSize = Number(argValue('--batch') ?? 25);
  let cursor: string | null = argValue('--cursor') ?? null;
  let schedules = 0;
  let rows = 0;
  do {
    const step = await backfillOnCallCoverage({ cursor, batchSize, days: COVERAGE_BACKFILL_DAYS });
    schedules += step.schedules;
    rows += step.rows;
    cursor = step.nextCursor;
    console.log(`schedules ${schedules}, rows ${rows}${cursor ? `, next cursor ${cursor}` : ''}`);
  } while (cursor);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
