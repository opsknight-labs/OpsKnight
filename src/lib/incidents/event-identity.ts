import { createHash } from 'node:crypto';
import type { EventPayload } from '@/lib/events';
import type { Prisma } from '@prisma/client';
import { acquireTextAdvisoryLocks } from '@/lib/db-locks';

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
