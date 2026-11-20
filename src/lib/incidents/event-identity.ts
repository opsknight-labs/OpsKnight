import { createHash } from 'node:crypto';
import type { EventPayload } from '@/lib/events';
import { Prisma, type Incident } from '@prisma/client';
import { acquireTextAdvisoryLocks } from '@/lib/db-locks';

// Generated, trusted column names retain Prisma's scalar projection even if a
// newer migration has added columns before this image is replaced or rolled back.
const incidentScalarColumns = Prisma.join(
  Object.values(Prisma.IncidentScalarFieldEnum).map(column => Prisma.raw(`"${column}"`))
);
const hitColumns = Prisma.join(
  Object.values(Prisma.IncidentScalarFieldEnum).map(column => Prisma.raw(`hit."${column}"`))
);
const appendedColumns = Prisma.join(
  Object.values(Prisma.IncidentScalarFieldEnum).map(column => Prisma.raw(`i."${column}"`))
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

/** For a resolve: how many other alert keys on the incident still fire (their latest alert is TRIGGERED). */
export type OpenEventIncident = Incident & { openOtherAlertKeys?: number };

/** Call after locking the canonical and legacy identities. Keep service/state
 * filtering before the limit, while avoiding a service-wide scan when a newly
 * active service has not yet appeared in PostgreSQL's statistics.
 *
 * With `forResolve`, an incident that only carries the key as an appended alert (content dedup) is found
 * too, and `openOtherAlertKeys` counts its other keys that still fire. Same single query either way.
 */
export async function findOpenEventIncident(
  tx: Prisma.TransactionClient,
  serviceId: string,
  dedupKeys: readonly string[],
  forResolve = false
): Promise<OpenEventIncident | null> {
  if (!dedupKeys.length) return null;
  if (!forResolve) {
    const [incident] = await tx.$queryRaw<Incident[]>`
      SELECT candidate.* FROM (
        SELECT ${incidentScalarColumns} FROM "Incident"
        WHERE "dedupKey" IN (${Prisma.join([...dedupKeys])})
        OFFSET 0
      ) candidate
      WHERE candidate."serviceId" = ${serviceId}
        AND candidate.status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
      -- Deterministic when several incidents share a key: the oldest open one owns it.
      ORDER BY candidate."createdAt" ASC, candidate.id ASC
      LIMIT 1
    `;
    return incident ?? null;
  }
  const keys = Prisma.join([...dedupKeys]);
  // Appended alerts are stored under the canonical key, the first one. shortcut: only the key's latest
  // 20 alerts are searched for an appended link; widen if keys re-trigger that often while appended.
  // No ORDER BY over the UNION ALL: Append runs the owned-key branch first and the appended-key branch
  // only when it found nothing.
  const [incident] = await tx.$queryRaw<OpenEventIncident[]>`
    SELECT ${hitColumns}, (
      SELECT count(*)::int FROM (
        SELECT DISTINCT ON (a."dedupKey") a."dedupKey", a.status, a."createdAt" FROM "Alert" a
        WHERE a."incidentId" = hit.id AND a."dedupKey" NOT IN (${keys})
        ORDER BY a."dedupKey", a."createdAt" DESC, a.id DESC
      ) latest
      WHERE latest.status = 'TRIGGERED'
        -- A key that later opened an incident of its own is tracked (and resolved) there, not here.
        AND NOT EXISTS (
          SELECT 1 FROM "Incident" own
          WHERE own."dedupKey" = latest."dedupKey" AND own."serviceId" = hit."serviceId"
            AND own.id <> hit.id AND own."createdAt" > latest."createdAt"
        )
    ) AS "openOtherAlertKeys"
    FROM (
      (SELECT candidate.* FROM (
        SELECT ${incidentScalarColumns} FROM "Incident"
        WHERE "dedupKey" IN (${keys})
        OFFSET 0
      ) candidate
      WHERE candidate."serviceId" = ${serviceId}
        AND candidate.status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
      ORDER BY candidate."createdAt" ASC, candidate.id ASC
      LIMIT 1)
      UNION ALL
      (SELECT ${appendedColumns} FROM (
        SELECT "incidentId" FROM "Alert"
        WHERE "dedupKey" = ${dedupKeys[0]}
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 20
      ) recent
      JOIN "Incident" i ON i.id = recent."incidentId"
      WHERE i."serviceId" = ${serviceId}
        AND i.status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
      LIMIT 1)
      LIMIT 1
    ) hit
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
