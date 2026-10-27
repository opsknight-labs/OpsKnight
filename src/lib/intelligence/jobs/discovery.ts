import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { enqueueWorkItems, WORK_KINDS } from './work-queue';

type Client = Prisma.TransactionClient | typeof prisma;

const CURSOR_NAME = 'incident-discovery';

/**
 * Incidents are only discovered once they are older than this, so a transaction that took longer to
 * commit than a later one cannot slip behind the watermark. Ingestion transactions take milliseconds.
 */
export const DISCOVERY_SAFETY_LAG_MS = 30_000;

export interface DiscoveryResult {
  /** False when another worker holds the singleton discovery lock this cycle. */
  ran: boolean;
  discovered: number;
}

/**
 * Finds new incidents by keyset watermark and signals one INDEX_INCIDENT work item for each. This is
 * what keeps intelligence entirely off the ingestion path: nothing is written when an incident is
 * created. The first run starts from "now"; history is indexed only through an explicit backfill.
 */
export async function discoverNewIncidents(
  options: { limit: number; now?: Date; lagMs?: number },
  client: typeof prisma = prisma
): Promise<DiscoveryResult> {
  const now = options.now ?? new Date();
  const upperBound = new Date(now.getTime() - (options.lagMs ?? DISCOVERY_SAFETY_LAG_MS));

  return client.$transaction(async tx => {
    const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('intelligence-incident-discovery', 0)) AS locked`;
    if (!locked) return { ran: false, discovered: 0 };

    const cursor = await tx.intelligenceCursor.findUnique({ where: { name: CURSOR_NAME } });
    if (!cursor) {
      await tx.intelligenceCursor.create({
        data: { name: CURSOR_NAME, watermarkAt: upperBound, lastId: '' },
      });
      return { ran: true, discovered: 0 };
    }

    const rows = await tx.$queryRaw<Array<{ id: string; createdAt: Date }>>(Prisma.sql`
      SELECT "id", "createdAt" FROM "Incident"
      WHERE ("createdAt" > ${cursor.watermarkAt}
             OR ("createdAt" = ${cursor.watermarkAt} AND "id" > ${cursor.lastId}))
        AND "createdAt" <= ${upperBound}
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT ${options.limit}
    `);
    if (rows.length === 0) return { ran: true, discovered: 0 };

    await enqueueWorkItems(
      rows.map(row => ({ kind: WORK_KINDS.INDEX_INCIDENT, subjectKey: row.id })),
      tx
    );
    const last = rows[rows.length - 1];
    await tx.intelligenceCursor.update({
      where: { name: CURSOR_NAME },
      data: { watermarkAt: last.createdAt, lastId: last.id },
    });
    return { ran: true, discovered: rows.length };
  });
}

/**
 * Anti-entropy: repairs anything the watermark could not see — incidents that never got a
 * fingerprint, and incidents resolved after they were indexed. Derived data is always rebuildable
 * from the source of truth, so a lost job or a missed row heals on the next sweep.
 */
export async function reconcileFingerprints(
  options: { limit: number; lookbackDays: number; now?: Date; lagMs?: number },
  client: Client = prisma
): Promise<{ missing: number; staleResolution: number }> {
  const now = options.now ?? new Date();
  const upperBound = new Date(now.getTime() - (options.lagMs ?? DISCOVERY_SAFETY_LAG_MS));
  const lowerBound = new Date(now.getTime() - options.lookbackDays * 86_400_000);

  const missing = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i."id" FROM "Incident" i
    LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
    WHERE i."createdAt" > ${lowerBound} AND i."createdAt" <= ${upperBound} AND f."incidentId" IS NULL
    ORDER BY i."createdAt" DESC
    LIMIT ${options.limit}
  `);
  const staleResolution = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i."id" FROM "Incident" i
    JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
    WHERE i."createdAt" > ${lowerBound} AND i."resolvedAt" IS NOT NULL AND f."resolvedAt" IS NULL
    ORDER BY i."resolvedAt" DESC
    LIMIT ${options.limit}
  `);

  await enqueueWorkItems(
    [...missing, ...staleResolution].map(row => ({
      kind: WORK_KINDS.INDEX_INCIDENT,
      subjectKey: row.id,
    })),
    client
  );
  return { missing: missing.length, staleResolution: staleResolution.length };
}
