import type { BusinessServiceTier, IncidentUrgency } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { impactThreshold, meetsThreshold } from './health';

export const PREVIEW_WINDOW_DAYS = 30;
const MAX_INCIDENTS = 2000;
const MAX_SERVICES = 500;

export type ImpactPreview = {
  windowDays: number;
  /** Incidents on the member services in the window that the draft thresholds would count. */
  counted: number;
  /** All incidents on the member services in the window. */
  total: number;
  /** The scan stopped at the cap, so the numbers are a floor. */
  truncated: boolean;
};

export type ImpactPreviewDraft = {
  criticality: BusinessServiceTier | null;
  impactMinUrgency: IncidentUrgency | null;
  impactMaxPriority: string | null;
  memberServiceIds: readonly string[];
};

/** Pure: how many of the incidents the draft thresholds would count. */
export function countAgainstDraft(
  incidents: readonly { urgency: IncidentUrgency; priority: string | null }[],
  draft: Omit<ImpactPreviewDraft, 'memberServiceIds'>
) {
  const threshold = impactThreshold(draft);
  return incidents.filter(incident => meetsThreshold(incident, threshold)).length;
}

/**
 * "This tier and these thresholds would have counted N incidents in the last 30 days." Direct incidents
 * on the draft's member services only (dependencies are not walked), scoped to what the actor may read,
 * and bounded: at most 500 services and 2,000 incidents.
 */
export async function previewBusinessServiceImpact(
  draft: ImpactPreviewDraft,
  actor: AuthorizationActor,
  now = new Date()
): Promise<ImpactPreview> {
  const serviceIds = draft.memberServiceIds.slice(0, MAX_SERVICES);
  if (serviceIds.length === 0) {
    return { windowDays: PREVIEW_WINDOW_DAYS, counted: 0, total: 0, truncated: false };
  }
  const since = new Date(now.getTime() - PREVIEW_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.incident.findMany({
    where: {
      AND: [incidentReadWhere(actor), { serviceId: { in: serviceIds }, createdAt: { gte: since } }],
    },
    take: MAX_INCIDENTS + 1,
    orderBy: { createdAt: 'desc' },
    select: { urgency: true, priority: true },
  });
  const truncated = rows.length > MAX_INCIDENTS;
  const incidents = rows.slice(0, MAX_INCIDENTS);
  return {
    windowDays: PREVIEW_WINDOW_DAYS,
    counted: countAgainstDraft(incidents, draft),
    total: incidents.length,
    truncated,
  };
}
