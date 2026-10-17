import type { Prisma } from '@prisma/client';

/** Serialize service policy assignment with draft, publication and mode changes. */
export async function lockAutomationService(tx: Prisma.TransactionClient, serviceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation:${serviceId}`}, 0))`;
}
