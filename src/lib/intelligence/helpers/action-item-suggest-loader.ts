import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { actionItemReadWhere, incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getIntelligenceSettings } from '../settings/service';
import {
  findDuplicateActionItems,
  suggestActionItemOwner,
  type DuplicateActionItem,
  type SuggestedOwner,
} from './action-item-suggest';

/** Open items compared in memory; the most recent first, an older tail is not checked. */
const OPEN_ITEMS_SCANNED = 500;
/** A recurrence older than this does not mark an item. */
const RECURRENCE_WINDOW_DAYS = 90;

export interface ActionItemDraftSuggestions {
  service: { id: string; name: string } | null;
  owner: SuggestedOwner | null;
  duplicates: DuplicateActionItem[];
}

async function helpersOn() {
  const settings = await getIntelligenceSettings();
  return settings.enabled && settings.opsHelpersEnabled;
}

/**
 * Suggestions for an action item being added to the postmortem of `incidentId`: the incident's service, a
 * likely owner and open look-alikes the reader can see. Two bounded reads; no model call. Null while the
 * helpers are off or the incident is not readable.
 */
export async function suggestForActionItemDraft(
  actor: AuthorizationActor,
  draft: { incidentId: string; title: string }
): Promise<ActionItemDraftSuggestions | null> {
  if (actor.status !== 'ACTIVE' || !(await helpersOn())) return null;
  const incident = await prisma.incident.findFirst({
    where: { AND: [{ id: draft.incidentId }, incidentReadWhere(actor)] },
    select: {
      service: {
        select: {
          id: true,
          name: true,
          team: { select: { name: true, teamLead: { select: { id: true, name: true } } } },
        },
      },
      postmortem: { select: { createdBy: { select: { id: true, name: true } } } },
    },
  });
  if (!incident) return null;
  const open = draft.title.trim()
    ? await prisma.actionItem.findMany({
        where: { AND: [actionItemReadWhere(actor), { status: { not: 'COMPLETED' } }] },
        select: { id: true, title: true, incidentId: true },
        orderBy: { createdAt: 'desc' },
        take: OPEN_ITEMS_SCANNED,
      })
    : [];
  return {
    service: { id: incident.service.id, name: incident.service.name },
    owner: suggestActionItemOwner({
      teamLead: incident.service.team?.teamLead ?? null,
      teamName: incident.service.team?.name ?? null,
      author: incident.postmortem?.createdBy ?? null,
    }),
    duplicates: findDuplicateActionItems(draft.title, open),
  };
}

/**
 * Of `itemIds` (already scoped by the caller), the unfinished ones whose problem (the masked incident title of
 * `IncidentFingerprint.template`) came back on the same service after the item was written. Empty while the
 * helpers are off. One statement on idx_incident_fingerprint_problem.
 */
export async function recurredActionItemIds(
  itemIds: string[],
  now: Date = new Date()
): Promise<Set<string>> {
  if (itemIds.length === 0 || !(await helpersOn())) return new Set();
  const since = new Date(now.getTime() - RECURRENCE_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a."id" FROM "ActionItem" a
    JOIN "IncidentFingerprint" f ON f."incidentId" = a."incidentId"
    WHERE a."id" = ANY(${itemIds}) AND a."status" <> 'COMPLETED' AND f."template" <> ''
      AND EXISTS (
        SELECT 1 FROM "IncidentFingerprint" g
        WHERE g."serviceId" = f."serviceId" AND g."template" = f."template"
          AND g."incidentId" <> f."incidentId"
          AND g."incidentCreatedAt" > a."createdAt" AND g."incidentCreatedAt" >= ${since})`);
  return new Set(rows.map(row => row.id));
}
