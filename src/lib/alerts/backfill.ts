import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { normalizeAlertShape } from './normalization';

export interface AlertBackfillCursor {
  id: string;
  createdAt: Date;
}

/** Bounded online metadata repair. Payload and source edits are never overwritten. A concurrent
 * change skips that row; a later pass from the start retries it against the new source version.
 */
export async function backfillAlertShapes(
  options: { limit?: number; after?: AlertBackfillCursor } = {},
  client: Pick<PrismaClient, '$transaction'> = prisma
) {
  const limit = options.limit ?? 250;
  if (!Number.isInteger(limit) || limit < 1 || limit > 250)
    throw new RangeError('Alert backfill batch must be between 1 and 250.');
  return client.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', '2000', true), set_config('lock_timeout', '100', true)`;
      const rows = await tx.alert.findMany({
        where: {
          severity: null,
          ...(options.after
            ? {
                OR: [
                  { createdAt: { gt: options.after.createdAt } },
                  { createdAt: options.after.createdAt, id: { gt: options.after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, createdAt: true, updatedAt: true, incidentId: true, payload: true },
      });
      if (!rows.length)
        return {
          scanned: 0,
          updated: 0,
          skipped: 0,
          after: null,
          done: true,
          incidentIds: [] as string[],
        };
      const values = rows.map(row => {
        const source =
          row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
            ? row.payload
            : {};
        const metadata = normalizeAlertShape({
          summary: typeof source.summary === 'string' ? source.summary : '',
          severity: typeof source.severity === 'string' ? source.severity : undefined,
          custom_details: source.custom_details,
        });
        return Prisma.sql`(${row.id}, ${row.updatedAt}::timestamp, ${JSON.stringify(row.payload)}::jsonb,
        ${metadata.severity}, ${metadata.resourceKey}::text, ${JSON.stringify(metadata.labels)}::jsonb, ${metadata.fingerprintHash}::text)`;
      });
      const updated = await tx.$queryRaw<Array<{ incidentId: string | null }>>(Prisma.sql`
      UPDATE "Alert" a SET severity = candidate.severity, "resourceKey" = candidate.resource_key,
        labels = candidate.labels, "fingerprintHash" = candidate.fingerprint_hash, "updatedAt" = clock_timestamp()
      FROM (VALUES ${Prisma.join(values)}) candidate(id, observed_at, payload, severity, resource_key, labels, fingerprint_hash)
      WHERE a.id = candidate.id AND a.severity IS NULL AND a.payload = candidate.payload
        AND a."updatedAt" IS NOT DISTINCT FROM candidate.observed_at
      RETURNING a."incidentId" AS "incidentId"`);
      const last = rows[rows.length - 1];
      return {
        scanned: rows.length,
        updated: updated.length,
        skipped: rows.length - updated.length,
        after: { id: last.id, createdAt: last.createdAt },
        done: rows.length < limit,
        incidentIds: [...new Set(updated.flatMap(row => (row.incidentId ? [row.incidentId] : [])))],
      };
    },
    { maxWait: 500, timeout: 5000 }
  );
}
