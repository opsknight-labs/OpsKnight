import type { IncidentUrgency, Prisma } from '@prisma/client';
import { normalizeIncidentPriority, type IncidentPriority } from './priority';
import {
  defaultAlertClassification,
  priorityFromUrgency,
  type AlertSeverity,
} from './classification-contract';

export { ALERT_SEVERITIES } from './classification-contract';
export type { AlertSeverity } from './classification-contract';

export type ClassificationProvenance = {
  source:
    | 'EXPLICIT'
    | 'INTEGRATION_POLICY'
    | 'SERVICE_POLICY'
    | 'WORKSPACE_POLICY'
    | 'URGENCY_FALLBACK'
    | 'LEGACY_SEVERITY_DEFAULT'
    | 'DEFAULT'
    | 'NONE';
  policyId: string | null;
  policyVersion: number | null;
  rule: string | null;
  scope: string | null;
};
export type IncidentClassification = {
  priority: IncidentPriority | null;
  urgency: IncidentUrgency;
  prioritySource: string;
  urgencySource: string;
  priorityProvenance: ClassificationProvenance;
  urgencyProvenance: ClassificationProvenance;
  policyId: string | null;
  policyVersion: number | null;
  rule: string | null;
};

type LoadedPolicy = Prisma.IncidentClassificationPolicyGetPayload<{ include: { rules: true } }>;
type LoadedRule = LoadedPolicy['rules'][number];

function sourceFor(scopeKey: string): ClassificationProvenance['source'] {
  if (scopeKey.startsWith('integration:')) return 'INTEGRATION_POLICY';
  if (scopeKey.startsWith('service:')) return 'SERVICE_POLICY';
  return 'WORKSPACE_POLICY';
}

async function loadPolicies(
  tx: Prisma.TransactionClient,
  serviceId: string,
  integrationId?: string | null
) {
  if (!tx.incidentClassificationPolicy) return [];
  const keys = [
    ...(integrationId ? [`integration:${integrationId}`] : []),
    `service:${serviceId}`,
    'workspace',
  ];
  const latest = await Promise.all(
    keys.map(scopeKey =>
      tx.incidentClassificationPolicy.findFirst({
        where: { scopeKey, sealedAt: { not: null } },
        orderBy: { version: 'desc' },
        include: { rules: true },
      })
    )
  );
  return latest.filter((policy): policy is LoadedPolicy => policy !== null);
}

function provenance(policy: LoadedPolicy, severity: AlertSeverity): ClassificationProvenance {
  return {
    source: sourceFor(policy.scopeKey),
    policyId: policy.id,
    policyVersion: policy.version,
    rule: `ALERT_SEVERITY:${severity}`,
    scope: policy.scopeKey,
  };
}

function priorityMode(rule: LoadedRule): 'INHERIT' | 'FALLBACK' | 'SET' | 'CLEAR' {
  if (
    rule.priorityMode === 'INHERIT' ||
    rule.priorityMode === 'FALLBACK' ||
    rule.priorityMode === 'CLEAR'
  )
    return rule.priorityMode;
  return rule.priority == null ? 'CLEAR' : 'SET';
}

function urgencyMode(rule: LoadedRule): 'INHERIT' | 'SET' | 'DEFAULT' {
  if (rule.urgencyMode === 'INHERIT' || rule.urgencyMode === 'DEFAULT') return rule.urgencyMode;
  return rule.urgency == null ? 'DEFAULT' : 'SET';
}

/** The sole production classifier. Fields inherit independently and CLEAR blocks fallback. */
export async function resolveIncidentClassification(
  tx: Prisma.TransactionClient,
  input: {
    serviceId: string;
    integrationId?: string | null;
    explicitPriority?: string | null;
    explicitUrgency?: IncidentUrgency | null;
    alertSeverity?: AlertSeverity | null;
  }
): Promise<IncidentClassification> {
  const explicitPriority = normalizeIncidentPriority(input.explicitPriority);
  const severity = input.alertSeverity ?? null;
  const policies = await loadPolicies(tx, input.serviceId, input.integrationId);
  const fallback = severity ? defaultAlertClassification(severity) : null;
  let priority = explicitPriority;
  let priorityCleared = false;
  let ruleFallbackPolicy: LoadedPolicy | null = null;
  let priorityProvenance: ClassificationProvenance = explicitPriority
    ? { source: 'EXPLICIT', policyId: null, policyVersion: null, rule: null, scope: null }
    : { source: 'NONE', policyId: null, policyVersion: null, rule: null, scope: null };
  let urgency = input.explicitUrgency ?? null;
  let urgencyProvenance: ClassificationProvenance = input.explicitUrgency
    ? { source: 'EXPLICIT', policyId: null, policyVersion: null, rule: null, scope: null }
    : { source: 'DEFAULT', policyId: null, policyVersion: null, rule: null, scope: null };

  if (severity)
    for (const policy of policies) {
      const rule = policy.rules.find(
        candidate => candidate.matchType === 'ALERT_SEVERITY' && candidate.matchValue === severity
      );
      if (!rule) continue;
      if (priority === null && !priorityCleared) {
        const mode = priorityMode(rule);
        if (mode === 'SET') {
          priority = normalizeIncidentPriority(rule.priority);
          priorityProvenance = provenance(policy, severity);
        } else if (mode === 'CLEAR') {
          priorityCleared = true;
          priorityProvenance = provenance(policy, severity);
        } else if (mode === 'FALLBACK') {
          priorityCleared = true;
          ruleFallbackPolicy = policy;
          priorityProvenance = provenance(policy, severity);
        }
      }
      if (urgency === null) {
        const mode = urgencyMode(rule);
        if (mode === 'SET' && rule.urgency) {
          urgency = rule.urgency;
          urgencyProvenance = provenance(policy, severity);
        } else if (mode === 'DEFAULT') {
          urgency = fallback?.urgency ?? 'MEDIUM';
          urgencyProvenance = provenance(policy, severity);
        }
      }
    }

  if (urgency === null) {
    urgency = fallback?.urgency ?? 'MEDIUM';
    urgencyProvenance = {
      source: severity ? 'LEGACY_SEVERITY_DEFAULT' : 'DEFAULT',
      policyId: null,
      policyVersion: null,
      rule: null,
      scope: null,
    };
  }
  const fallbackPolicy = policies.find(
    policy =>
      policy.priorityFallbackMode === 'ENABLED' ||
      policy.priorityFallbackMode === 'DISABLED' ||
      (policy.priorityFallbackMode == null && policy.derivePriorityFromUrgency)
  );
  const fallbackEnabled =
    fallbackPolicy?.priorityFallbackMode === 'ENABLED' ||
    (fallbackPolicy?.priorityFallbackMode == null && fallbackPolicy?.derivePriorityFromUrgency);
  if (priority === null && ruleFallbackPolicy) {
    priority = priorityFromUrgency(urgency);
    priorityProvenance = {
      source: 'URGENCY_FALLBACK',
      policyId: ruleFallbackPolicy.id,
      policyVersion: ruleFallbackPolicy.version,
      rule: `ALERT_SEVERITY:${severity}`,
      scope: ruleFallbackPolicy.scopeKey,
    };
  } else if (priority === null && !priorityCleared && fallbackPolicy && fallbackEnabled) {
    priority = priorityFromUrgency(urgency);
    priorityProvenance = {
      source: 'URGENCY_FALLBACK',
      policyId: fallbackPolicy.id,
      policyVersion: fallbackPolicy.version,
      rule: 'URGENCY_FALLBACK',
      scope: fallbackPolicy.scopeKey,
    };
  }
  const compatibility = priorityProvenance.policyId ? priorityProvenance : urgencyProvenance;
  const legacySource = (value: ClassificationProvenance) =>
    value.source === 'WORKSPACE_POLICY' ? 'CLASSIFICATION_RULE' : value.source;
  return {
    priority,
    urgency,
    prioritySource: priority === null ? 'NONE' : legacySource(priorityProvenance),
    urgencySource: legacySource(urgencyProvenance),
    priorityProvenance,
    urgencyProvenance,
    policyId: compatibility.policyId,
    policyVersion: compatibility.policyVersion,
    rule: compatibility.rule,
  };
}
