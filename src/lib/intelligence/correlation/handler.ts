import 'server-only';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS, type ClaimedWorkItem } from '../jobs/work-queue';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import { joinCorrelationGroup, type CorrelationMode } from './groups';
import { computeSignature, isCriticalIncident } from './rules';
import { loadActiveEdges } from '../dependencies/service';
import { topologyScope } from '../dependencies/graph';
import { getAutoGate } from '../evaluation/quality';

export type CorrelationOutcome =
  | 'incident_gone'
  | 'skipped_off'
  | 'skipped_no_rules'
  | 'skipped_critical'
  | 'correlated'
  | 'no_match';

export interface CorrelationSummary {
  outcome: CorrelationOutcome;
  groups: number;
  suggestions: number;
}

/**
 * Evaluates the effective policy's rules for one incident and records the result. SHADOW records
 * decisions only; SUGGEST also proposes reversible links. Nothing here merges incidents, modifies
 * incidents or alerts, or influences paging. Critical (highest-urgency) incidents are never grouped.
 */
export async function correlateIncident(
  item: Pick<ClaimedWorkItem, 'subjectKey'>,
  settings: IntelligenceSettingsView
): Promise<CorrelationSummary> {
  const incidentId = item.subjectKey;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, serviceId: true, urgency: true, status: true, createdAt: true },
  });
  const none = (outcome: CorrelationOutcome): CorrelationSummary => ({
    outcome,
    groups: 0,
    suggestions: 0,
  });
  if (!incident) return none('incident_gone');

  const policy = await resolveEffectivePolicy(incident.serviceId);
  if (policy.effectiveMode === 'OFF') return none('skipped_off');
  const rules = policy.definition.correlation.rules.filter(rule => rule.enabled);
  if (rules.length === 0 || !policy.policyId) return none('skipped_no_rules');
  if (isCriticalIncident(incident)) return none('skipped_critical');

  const fingerprint = await prisma.incidentFingerprint.findUnique({ where: { incidentId } });
  if (!fingerprint) throw new Error('Incident fingerprint is not ready yet');
  const labels =
    fingerprint.labels &&
    typeof fingerprint.labels === 'object' &&
    !Array.isArray(fingerprint.labels)
      ? Object.fromEntries(
          Object.entries(fingerprint.labels).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {};

  // AUTO falls back to SHADOW whenever its service certification gate is closed.
  const baseDecision: CorrelationMode = policy.effectiveMode === 'SUGGEST' ? 'SUGGESTED' : 'SHADOW';
  const policyId = policy.policyId;

  const edges = rules.some(rule => rule.kind === 'TOPOLOGY') ? await loadActiveEdges() : [];
  return withDbBudget(settings, async tx => {
    const eligible =
      policy.effectiveMode === 'AUTO' &&
      policy.source === 'service' &&
      ['OPEN', 'ACKNOWLEDGED'].includes(incident.status) &&
      Date.now() - +incident.createdAt <= 5 * 60_000 &&
      +incident.createdAt <= Date.now() + 60_000;
    const gate = eligible ? await getAutoGate(incident.serviceId, policy.definition, tx) : null;
    const decision: CorrelationMode = gate?.allowed ? 'ACCEPTED' : baseDecision;
    if (decision === 'ACCEPTED') {
      // Wait behind the existing initial-paging outbox; intelligence never adds a hold to it.
      const [paging] = await tx.$queryRaw<Array<{ next: Date | null }>>`
        SELECT min("scheduledAt") AS next FROM "BackgroundJob"
        WHERE "status" IN ('PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2')
          AND "payload"->>'incidentId' = ${incident.id}
          AND (("type" = 'ESCALATION' AND "scheduledAt" <= now())
            OR ("type" = 'SCHEDULED_TASK' AND "payload"->>'effect' = 'TRIGGER_ESCALATION_NOTIFICATIONS'))`;
      if (paging?.next) {
        const due = new Date(Math.max(+paging.next, Date.now() + 5000));
        await enqueueWorkItems(
          [{ kind: WORK_KINDS.CORRELATE_INCIDENT, subjectKey: incident.id, scheduledAt: due }],
          tx
        );
        await tx.$executeRaw`UPDATE "IntelligenceWorkItem" SET "scheduledAt" = GREATEST("scheduledAt", ${due})
          WHERE "kind" = ${WORK_KINDS.CORRELATE_INCIDENT} AND "subjectKey" = ${incident.id}`;
        return none('no_match');
      }
    }
    let groups = 0;
    let suggestions = 0;
    for (const rule of rules) {
      const scope = rule.kind === 'TOPOLOGY' ? topologyScope(edges, incident.serviceId) : null;
      if (rule.kind === 'TOPOLOGY' && !scope) continue;
      const signatureHash = computeSignature(rule, {
        serviceId: fingerprint.serviceId,
        template: fingerprint.template,
        labels,
      });
      if (!signatureHash) continue;
      const joined = await joinCorrelationGroup(tx, {
        policyId,
        policyVersion: policy.version,
        rule,
        serviceId: incident.serviceId,
        signatureHash,
        incident: { id: incident.id, createdAt: incident.createdAt },
        decision,
        ...(scope
          ? {
              scopeServiceIds: scope,
              scopeDefinition: policy.definition,
              match: { fingerprint: { ...fingerprint, labels }, minScore: rule.minScore },
            }
          : {}),
        ...(decision === 'ACCEPTED' && gate?.runId ? { certificationRunId: gate.runId } : {}),
      });
      if (joined.matched === false) continue;
      groups += 1;
      if (joined.relationshipCreated) suggestions += 1;
    }
    return {
      outcome: groups > 0 ? ('correlated' as const) : ('no_match' as const),
      groups,
      suggestions,
    };
  });
}

/**
 * Cheap pre-check used when chaining work: true only if intelligence is on for the incident's service
 * and its policy has at least one enabled rule. Any error answers false (no work is better than noise).
 */
export async function shouldCorrelate(incidentId: string): Promise<boolean> {
  try {
    const fingerprint = await prisma.incidentFingerprint.findUnique({
      where: { incidentId },
      select: { serviceId: true },
    });
    if (!fingerprint) return false;
    const policy = await resolveEffectivePolicy(fingerprint.serviceId);
    return (
      policy.effectiveMode !== 'OFF' &&
      policy.definition.correlation.rules.some(rule => rule.enabled)
    );
  } catch {
    return false;
  }
}
