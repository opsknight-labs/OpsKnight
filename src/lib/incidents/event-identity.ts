import { createHash } from 'node:crypto';
import type { EventPayload } from '@/lib/events';
import { Prisma, type Incident } from '@prisma/client';
import { acquireTextAdvisoryLocks } from '@/lib/db-locks';

// Generated, trusted column names retain Prisma's scalar projection even if a
// newer migration has added columns before this image is replaced or rolled back.
const incidentScalarColumns = Prisma.join(
  Object.values(Prisma.IncidentScalarFieldEnum).map(column => Prisma.raw(`"${column}"`))
);

function truncateDedupKey(key: unknown): string {
  const str = typeof key === 'string' ? key : String(key || '');
  if (str.length <= 512) return str;
  const hash = createHash('sha256').update(str).digest('hex').slice(0, 32);
  const prefixLength = 512 - 33; // 32 hex chars + 1 underscore
  return `${str.slice(0, prefixLength)}_${hash}`;
}

export function eventDedupKey(key: unknown, eventData: EventPayload['payload']): string {
  const supplied = typeof key === 'string' ? key.trim() : String(key ?? '').trim();
  return (
    supplied ||
    `unkeyed-${createHash('sha256')
      .update(
        JSON.stringify({
          source: eventData.source,
          summary: eventData.summary,
          details: eventData.custom_details ?? null,
        })
      )
      .digest('hex')}`
  );
}

export function normalizeDedupKeys(
  key: unknown,
  integrationId: string,
  eventData: EventPayload['payload']
): { primary: string; legacy?: string } {
  const supplied = typeof key === 'string' ? key.trim() : String(key ?? '').trim();
  const stableRaw = eventDedupKey(key, eventData);

  return {
    primary: truncateDedupKey(`${integrationId}:${stableRaw}`),
    legacy: supplied ? truncateDedupKey(supplied) : undefined,
  };
}

/** Call after locking the canonical and legacy identities. Keep service/state
 * filtering before the limit, while avoiding a service-wide scan when a newly
 * active service has not yet appeared in PostgreSQL's statistics.
 */
export async function findOpenEventIncident(
  tx: Prisma.TransactionClient,
  serviceId: string,
  dedupKeys: readonly string[]
): Promise<Incident | null> {
  if (!dedupKeys.length) return null;
  const [incident] = await tx.$queryRaw<Incident[]>`
    SELECT candidate.* FROM (
      SELECT ${incidentScalarColumns} FROM "Incident"
      WHERE "dedupKey" IN (${Prisma.join([...dedupKeys])})
      OFFSET 0
    ) candidate
    WHERE candidate."serviceId" = ${serviceId}
      AND candidate.status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
    LIMIT 1
  `;
  return incident ?? null;
}

/** Canonical and legacy identities share deterministic transaction-scoped locks. */
export async function lockEventDedupKeys(
  tx: Prisma.TransactionClient,
  serviceId: string,
  candidateDedupKeys: string[]
): Promise<void> {
  const lockKeys = Array.from(
    new Set(candidateDedupKeys.map(key => JSON.stringify([serviceId, key])))
  ).sort();
  await acquireTextAdvisoryLocks(tx, lockKeys);
}
