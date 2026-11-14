/**
 * Rebuilds approximate EscalationStepAttempt rows from the last 90 days of escalation timeline text.
 *
 *   npm run backfill:escalation-attempts -- [--batch-size=200] [--max-batches=50] [--after=<iso>,<incidentId>]
 *
 * Each batch prints a cursor; pass it as --after to resume. Re-running from the start is safe: existing
 * rows (live or backfilled) are never overwritten.
 */
import { PrismaClient } from '@prisma/client';
import {
  backfillEscalationStepAttempts,
  type StepAttemptBackfillCursor,
} from '../src/lib/escalation/step-attempt-backfill';

function option(name: string): string | undefined {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const batchSize = Number(option('batch-size') ?? 200);
  const maxBatches = Number(option('max-batches') ?? 50);
  const after = option('after');
  let cursor: StepAttemptBackfillCursor | null = after
    ? { createdAt: after.slice(0, after.indexOf(',')), id: after.slice(after.indexOf(',') + 1) }
    : null;
  let inserted = 0;
  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const result = await backfillEscalationStepAttempts(prisma, { cursor, batchSize });
      inserted += result.inserted;
      cursor = result.cursor;
      console.log(
        `batch ${batch + 1}: ${result.incidents} incidents, ${result.inserted} attempts` +
          (cursor ? `, resume with --after=${cursor.createdAt},${cursor.id}` : ', done')
      );
      if (!cursor) break;
    }
    console.log(`inserted ${inserted} approximate attempts${cursor ? ' (not finished)' : ''}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
