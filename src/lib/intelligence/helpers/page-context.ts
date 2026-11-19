import 'server-only';
import type { IntelligenceFindingKind, Prisma } from '@prisma/client';
import type { PageContext } from '@/lib/notification-payload';
import { getIntelligenceSettings } from '../settings/service';

/** The finding kinds a page links to; a write of any other kind leaves the page context alone. */
export const PAGE_CONTEXT_KINDS: readonly IntelligenceFindingKind[] = [
  'SIMILAR_INCIDENT',
  'CHANGE_CORRELATION',
  'RUNBOOK_RECOMMENDATION',
];

const FIELD: Partial<Record<IntelligenceFindingKind, keyof PageContext>> = {
  SIMILAR_INCIDENT: 'similarIncidentId',
  CHANGE_CORRELATION: 'changeId',
  RUNBOOK_RECOMMENDATION: 'runbookId',
};

/**
 * Rewrites `Incident.pageContext` from the rank-1 ACTIVE finding of each page kind, so page notifications
 * read it from the incident row they already load. Runs in the lane, inside the findings transaction; one
 * indexed read and one write that touches the row only when the context actually changed. Raw SQL so the
 * incident's `updatedAt` (an analysis input) does not move. Cleared while the switch is off.
 */
export async function refreshPageContext(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<void> {
  const settings = await getIntelligenceSettings(tx);
  let context: PageContext | null = null;
  if (settings.enabled && settings.pageContextEnabled) {
    const top = await tx.intelligenceFinding.findMany({
      where: { incidentId, status: 'ACTIVE', kind: { in: [...PAGE_CONTEXT_KINDS] }, rank: 1 },
      select: { kind: true, subjectRef: true },
    });
    for (const row of top) {
      const field = FIELD[row.kind];
      if (field && row.subjectRef) (context ??= {})[field] = row.subjectRef;
    }
  }
  const json = context ? JSON.stringify(context) : null;
  await tx.$executeRaw`
    UPDATE "Incident" SET "pageContext" = ${json}::jsonb
    WHERE "id" = ${incidentId} AND "pageContext" IS DISTINCT FROM ${json}::jsonb`;
}
