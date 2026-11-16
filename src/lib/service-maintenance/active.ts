import type { Prisma } from '@prisma/client';

// Kept dependency-free: the event ingestion transaction imports this on every trigger.

/** Hot path: one index range scan on (serviceId, endsAt, startsAt). */
export async function findActiveMaintenanceWindow(
  client: Prisma.TransactionClient,
  serviceId: string,
  at: Date
): Promise<{ id: string; title: string } | null> {
  const row = await client.maintenanceWindowService.findFirst({
    where: { serviceId, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { endsAt: 'desc' },
    select: { window: { select: { id: true, title: true } } },
  });
  return row?.window ?? null;
}
