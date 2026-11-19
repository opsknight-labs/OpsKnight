import type { Prisma } from '@prisma/client';

// Kept dependency-free: the event ingestion transaction imports this on every trigger.

/** Advisory lock key shared with the window commands and the end sweep. */
export const maintenanceWindowLockKey = (windowId: string) => `maintenance-window:${windowId}`;

/**
 * Finds the window that holds new alerts for a service at `at`.
 * Hot path: one index range scan on (serviceId, endsAt, startsAt); nothing more when
 * no window is active. When one is, the caller's transaction takes the window lock in
 * shared mode and re-checks it is unprocessed. The end sweep marks a window processed
 * under the exclusive lock, so an incident is either committed before that final check
 * (and released by it) or never linked to the window.
 */
export async function findActiveMaintenanceWindow(
  client: Prisma.TransactionClient,
  serviceId: string,
  at: Date
): Promise<{ id: string; title: string } | null> {
  const row = await client.maintenanceWindowService.findFirst({
    where: {
      serviceId,
      startsAt: { lte: at },
      endsAt: { gt: at },
      window: { endProcessedAt: null },
    },
    orderBy: { endsAt: 'desc' },
    select: { window: { select: { id: true, title: true } } },
  });
  if (!row) return null;
  const key = maintenanceWindowLockKey(row.window.id);
  await client.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
  const current = await client.maintenanceWindow.findUnique({
    where: { id: row.window.id },
    select: { endProcessedAt: true },
  });
  return current && !current.endProcessedAt ? row.window : null;
}
