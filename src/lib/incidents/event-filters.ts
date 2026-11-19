import type { Prisma } from '@prisma/client';

/**
 * Lifecycle events only: excludes captured war-room chat (CHAT_MESSAGE). `type` is nullable, and a bare
 * `not` would also drop untyped rows, so NULL is kept explicitly.
 */
export const LIFECYCLE_EVENT_WHERE = {
  OR: [{ type: null }, { type: { not: 'CHAT_MESSAGE' } }],
} satisfies Prisma.IncidentEventWhereInput;

/** Newest captured chat the incident page shows; the full capture stays on the intelligence time axis. */
export const CHAT_EVENT_DISPLAY_MAX = 50;
/** Captured chat a generated postmortem quotes (the earliest, as the evidence draft does). */
export const POSTMORTEM_CHAT_MAX = 10;
const POSTMORTEM_EVENT_MAX = 500;

/** Events for a generated postmortem timeline: lifecycle events plus a bounded slice of chat, oldest first. */
export async function loadPostmortemEvents(client: Prisma.TransactionClient, incidentId: string) {
  const [lifecycle, chat] = await Promise.all([
    client.incidentEvent.findMany({
      where: { incidentId, ...LIFECYCLE_EVENT_WHERE },
      orderBy: { createdAt: 'asc' },
      take: POSTMORTEM_EVENT_MAX,
    }),
    client.incidentEvent.findMany({
      where: { incidentId, type: 'CHAT_MESSAGE' },
      orderBy: { createdAt: 'asc' },
      take: POSTMORTEM_CHAT_MAX,
    }),
  ]);
  return [...lifecycle, ...chat];
}
