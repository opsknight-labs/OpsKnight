import 'server-only';
import { Prisma, type IntelligenceFindingKind } from '@prisma/client';
import type { PageContext } from '@/lib/notification-payload';
import type { IntelligenceModeValue, PolicyDefinition } from '../contract';
import { getIntelligenceSettings, resolveEffectivePolicy } from '../settings/service';

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

/** The page kinds a policy lets responders see: none outside SUGGEST/AUTO (SHADOW is hidden by design). */
export function visiblePageKinds(
  mode: IntelligenceModeValue,
  definition: PolicyDefinition
): IntelligenceFindingKind[] {
  if (mode !== 'SUGGEST' && mode !== 'AUTO') return [];
  return [
    ...(definition.similarity.enabled ? (['SIMILAR_INCIDENT'] as const) : []),
    ...(definition.response.enabled
      ? (['CHANGE_CORRELATION', 'RUNBOOK_RECOMMENDATION'] as const)
      : []),
  ];
}

/**
 * Drops the leads a switch or policy change just hid from every stored context in scope, so a page sent
 * after the change never carries them (analysis stops for OFF scopes, so no later findings write would).
 * `scope` null is every incident; a service id is that service; 'global' is every service without an
 * active override of its own.
 */
export async function clearPageContextKinds(
  tx: Prisma.TransactionClient,
  hidden: readonly IntelligenceFindingKind[],
  scope: { serviceId: string } | 'global' | null
): Promise<void> {
  // eslint-disable-next-line security/detect-object-injection -- kind is a closed finding-kind union
  const keys = [...new Set(hidden.map(kind => FIELD[kind]).filter(Boolean))] as string[];
  if (keys.length === 0) return;
  const where =
    scope === null
      ? Prisma.empty
      : scope === 'global'
        ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "IntelligencePolicy" p
            WHERE p."serviceId" = i."serviceId" AND p."overrideActive")`
        : Prisma.sql`AND i."serviceId" = ${scope.serviceId}`;
  await tx.$executeRaw`
    UPDATE "Incident" i SET "pageContext" = NULLIF(i."pageContext" - ${keys}::text[], '{}'::jsonb)
    WHERE i."pageContext" IS NOT NULL AND i."pageContext" ?| ${keys}::text[] ${where}`;
}

/**
 * Rewrites `Incident.pageContext` from the rank-1 ACTIVE finding of each page kind, so page notifications
 * read it from the incident row they already load. Runs in the lane, inside the findings transaction; one
 * indexed read and one write that touches the row only when the context actually changed. Raw SQL so the
 * incident's `updatedAt` (an analysis input) does not move. Cleared while the switch is off, and limited to
 * the kinds the service's effective policy shows responders (none in SHADOW).
 */
export async function refreshPageContext(
  tx: Prisma.TransactionClient,
  incidentId: string
): Promise<void> {
  const settings = await getIntelligenceSettings(tx);
  let context: PageContext | null = null;
  const incident =
    settings.enabled && settings.pageContextEnabled
      ? await tx.incident.findUnique({ where: { id: incidentId }, select: { serviceId: true } })
      : null;
  const policy = incident ? await resolveEffectivePolicy(incident.serviceId, tx) : null;
  const kinds = policy ? visiblePageKinds(policy.effectiveMode, policy.definition) : [];
  if (kinds.length > 0) {
    const top = await tx.intelligenceFinding.findMany({
      where: { incidentId, status: 'ACTIVE', kind: { in: kinds }, rank: 1 },
      select: { kind: true, subjectRef: true },
    });
    for (const row of top) {
      const field = FIELD[row.kind];
      // eslint-disable-next-line security/detect-object-injection -- field comes from the fixed FIELD table
      if (field && row.subjectRef) (context ??= {})[field] = row.subjectRef;
    }
  }
  const json = context ? JSON.stringify(context) : null;
  await tx.$executeRaw`
    UPDATE "Incident" SET "pageContext" = ${json}::jsonb
    WHERE "id" = ${incidentId} AND "pageContext" IS DISTINCT FROM ${json}::jsonb`;
}
