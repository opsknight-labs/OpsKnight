import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from './prisma';

export const providerFeedbackMetricsQuery = Prisma.sql`
  SELECT COUNT(*) FILTER (WHERE "quarantinedAt" IS NULL)::bigint AS pending,
    COUNT(*) FILTER (WHERE "quarantinedAt" IS NULL AND "reconciliationAttempts" > 0)::bigint AS retried,
    COUNT(*) FILTER (WHERE "quarantinedAt" IS NOT NULL)::bigint AS quarantined
  FROM "NotificationProviderFeedback" WHERE "processedAt" IS NULL`;
export async function collectProviderFeedbackMetrics() {
  return prisma.$transaction(
    async tx => {
      // A JS collector timeout alone cannot cancel a PostgreSQL scan.
      await tx.$executeRaw`SET LOCAL statement_timeout = '500ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
      const rows = await tx.$queryRaw<
        Array<{ pending: bigint; retried: bigint; quarantined: bigint }>
      >(providerFeedbackMetricsQuery);
      return {
        pending: Number(rows[0]?.pending ?? 0),
        retried: Number(rows[0]?.retried ?? 0),
        quarantined: Number(rows[0]?.quarantined ?? 0),
      };
    },
    { maxWait: 250, timeout: 1000 }
  );
}
