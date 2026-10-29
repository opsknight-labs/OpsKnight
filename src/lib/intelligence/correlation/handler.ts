import 'server-only';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import type { ClaimedWorkItem } from '../jobs/work-queue';
import { resolveEffectivePolicy, type IntelligenceSettingsView } from '../settings/service';
import { joinCorrelationGroup, type CorrelationMode } from './groups';
import { computeSignature, isCriticalIncident } from './rules';
import { loadActiveEdges } from '../dependencies/service';
import { topologyScope } from '../dependencies/graph';

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
    select: { id: true, serviceId: true, urgency: true, createdAt: true },
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

  // SHADOW (and the unreachable-until-certified AUTO) record only; SUGGEST proposes links.
  const decision: CorrelationMode = policy.effectiveMode === 'SUGGEST' ? 'SUGGESTED' : 'SHADOW';
  const policyId = policy.policyId;

  const edges = rules.some(rule => rule.kind === 'TOPOLOGY') ? await loadActiveEdges() : [];
  return withDbBudget(settings, async tx => {
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
              match: { fingerprint: { ...fingerprint, labels }, minScore: rule.minScore },
            }
          : {}),
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
