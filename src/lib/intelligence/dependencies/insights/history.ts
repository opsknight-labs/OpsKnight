import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * Appends one history row for a dependency edge. Call it inside the same transaction as the write
 * it describes. Call sites to wire (service.ts and the observer/importers):
 *   declareDependency  -> state 'ACTIVE',  origin 'DECLARED'
 *   reviewDependency   -> APPROVE 'ACTIVE' / REJECT 'REJECTED' (origin from the row)
 *   removeDependency   -> state 'REMOVED' (origin from the row)
 *   observer / import  -> 'SUGGESTED' (or 'ACTIVE' when auto-accepted), origin 'OBSERVED'
 * Edges written without it are replayed from their createdAt and current status, so history is
 * approximate (never wrong about "exists now") until every writer calls this.
 */
export async function recordDependencyEvent(
  client: Client,
  event: {
    upstreamServiceId: string;
    downstreamServiceId: string;
    state: 'ACTIVE' | 'SUGGESTED' | 'REJECTED' | 'REMOVED';
    origin: 'DECLARED' | 'OBSERVED';
    actorId?: string | null;
  }
): Promise<void> {
  await client.serviceDependencyEvent.create({ data: { ...event, actorId: event.actorId ?? null } });
}
