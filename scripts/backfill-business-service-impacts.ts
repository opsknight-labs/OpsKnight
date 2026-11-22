import prisma from '../src/lib/prisma';
import {
  backfillDirectImpacts,
  type ImpactBackfillCursor,
} from '../src/lib/business-services/impacts';

/**
 * Writes DIRECT business-service impact rows for the last 90 days of incidents so uptime and the
 * impact timeline have history from day one. Dry run by default; pass --apply to write.
 *   npx ts-node -P tsconfig.script.json -r tsconfig-paths/register scripts/backfill-business-service-impacts.ts [--apply] [--days=90] [--batch=500]
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const arg = (name: string, fallback: number) => {
    const raw = process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1];
    return raw === undefined ? fallback : Number(raw);
  };
  const days = arg('days', 90);
  const batch = arg('batch', 500);
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error('--days must be 1-400');
  if (!Number.isInteger(batch) || batch < 1 || batch > 5000)
    throw new Error('--batch must be 1-5000');
  const since = new Date(Date.now() - days * 86_400_000);
  let after: ImpactBackfillCursor | undefined;
  const totals = { scanned: 0, candidates: 0, written: 0 };
  for (;;) {
    const result = await backfillDirectImpacts({ since, limit: batch, after, apply });
    totals.scanned += result.scanned;
    totals.candidates += result.candidates;
    totals.written += result.written;
    if (result.done || !result.after) break;
    after = result.after;
  }
  console.log(
    JSON.stringify({
      mode: apply ? 'applied' : 'dry-run',
      days,
      scanned: totals.scanned,
      candidates: totals.candidates,
      ...(apply ? { written: totals.written } : { wouldWrite: totals.written }),
    })
  );
}

main()
  .catch(() => {
    // Fixed error text: never print a datasource or connection secret.
    console.error(
      'Business-service impact backfill stopped. Check database connectivity and arguments; rerun to resume.'
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
