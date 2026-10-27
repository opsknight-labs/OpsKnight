import { readPublishedSlaPolicies } from '@/lib/incident-policies/published';
import type { Prisma } from '@prisma/client';

export { validateCapturedIncidentSlaContract } from './captured-contract';
export type { CapturedIncidentSlaContract } from './captured-contract';

export type NewIncidentSlaContract = {
  ackTargetMs: number;
  resolveTargetMs: number;
  source:
    | 'SERVICE_PRIORITY_OVERRIDE'
    | 'WORKSPACE_PRIORITY_OVERRIDE'
    | 'SERVICE_DEFAULT'
    | 'WORKSPACE_DEFAULT';
  policyId: string;
  policyVersion: number;
  policyRule: string;
  capturedAt: Date;
};

/** New incidents only. Never use this resolver to reconstruct historical contracts.
 * Read both scopes in one SQL snapshot; immutable versions make all rule reads stable.
 * Missing workspace configuration fails closed, never substitutes runtime constants.
 */
export async function resolveNewIncidentSlaContract(
  tx: Prisma.TransactionClient,
  input: { serviceId: string; priority?: string | null; now: Date },
  publishedPolicies?: Awaited<ReturnType<typeof readPublishedSlaPolicies>>
): Promise<NewIncidentSlaContract> {
  const policies =
    publishedPolicies ??
    (await readPublishedSlaPolicies(tx, [`service:${input.serviceId}`, 'workspace']));
  const service = policies.find(policy => policy.scopeKey === `service:${input.serviceId}`);
  const workspace = policies.find(policy => policy.scopeKey === 'workspace');
  const match = input.priority
    ?.trim()
    .toUpperCase()
    .match(/^P?([1-5])$/);
  const priority = match ? `P${match[1]}` : null;
  const serviceRule = priority
    ? service?.rules.find(candidate => candidate.priority === priority)
    : undefined;
  const workspaceRule = priority
    ? workspace?.rules.find(candidate => candidate.priority === priority)
    : undefined;
  const rule = serviceRule ?? workspaceRule;
  const policy = serviceRule
    ? service
    : workspaceRule
      ? workspace
      : service && !service.inheritWorkspace
        ? service
        : workspace;
  if (!policy)
    throw new Error('Incident SLA policy is not configured. Apply the versioned SLA migration.');
  const ackTargetMs = rule ? rule.ackTargetMs : policy.baseAckTargetMs;
  const resolveTargetMs = rule ? rule.resolveTargetMs : policy.baseResolveTargetMs;
  if (!ackTargetMs || !resolveTargetMs)
    throw new Error('Incident SLA policy has no valid target pair.');
  return {
    ackTargetMs,
    resolveTargetMs,
    source: serviceRule
      ? 'SERVICE_PRIORITY_OVERRIDE'
      : workspaceRule
        ? 'WORKSPACE_PRIORITY_OVERRIDE'
        : policy.scopeKey === 'workspace'
          ? 'WORKSPACE_DEFAULT'
          : 'SERVICE_DEFAULT',
    policyId: policy.id,
    policyVersion: policy.version,
    policyRule: rule ? rule.priority : 'BASE',
    capturedAt: input.now,
  };
}
