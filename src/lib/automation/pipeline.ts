import { Prisma } from '@prisma/client';
import type { EventPayload } from '@/lib/events';
import { captureResponderSnapshot } from '@/lib/escalation/automation-snapshot';
import { automationIntelligenceContext } from '@/lib/intelligence/ingest-hooks';
import { getCachedCompiledVersion } from './cache';
import { builtinContext } from './context/builtins';
import { extractContextWithProvenance } from './context/extract';
import { LIMITS, type Context } from './contract';
import { evaluateAutomation, type Evaluation } from './evaluator';
import type { IntegrationEventEnvelope, RuntimeEvaluation } from './runtime';

/**
 * One pipeline, one trace (J1.5). Per service, the noise-control static decision can run before automation
 * (noise-first) so automation sees the transformed severity, urgency and labels, does no work for dropped or
 * appended alerts, and orchestration REROUTE_SERVICE / ATTACH_RUNBOOK are applied through the automation
 * route and the runbook binding path. OFF keeps today's order; SHADOW records what noise-first would have
 * decided on the noise decision's evidence; ON applies it.
 */
export type PipelineOrder = 'OFF' | 'SHADOW' | 'ON';

export interface NoiseTransformLike {
  severity?: string;
  labels?: Record<string, string>;
  serviceId?: string;
  runbookIds?: string[];
}

/** What automation is given when it runs after the noise decision. Unchanged inputs are returned as is. */
export function noiseFirstInputs<C extends { priority: string | null; urgency: string }>(
  envelope: IntegrationEventEnvelope,
  classification: C,
  transform: NoiseTransformLike | undefined,
  urgency: string
): { envelope: IntegrationEventEnvelope; classification: C } {
  if (!transform?.severity && !transform?.labels && urgency === classification.urgency)
    return { envelope, classification };
  const payload = envelope.event.payload;
  const details =
    payload.custom_details &&
    typeof payload.custom_details === 'object' &&
    !Array.isArray(payload.custom_details)
      ? (payload.custom_details as Record<string, unknown>)
      : {};
  return {
    envelope: {
      ...envelope,
      event: {
        ...envelope.event,
        payload: {
          ...payload,
          ...(transform?.severity
            ? { severity: transform.severity as EventPayload['payload']['severity'] }
            : {}),
          ...(transform?.labels ? { custom_details: { ...details, ...transform.labels } } : {}),
        },
      },
    },
    classification: { ...classification, urgency },
  };
}

export interface PipelineOutcome {
  priority: string | null;
  route: string;
  policyId: string | null;
}

export function outcomeOf(
  result: Evaluation | null,
  basePriority: string | null,
  defaultPolicyId: string | null
): PipelineOutcome {
  const priority = result?.enrichedContext.priority;
  const route = result?.outcome ?? { type: 'SERVICE_DEFAULT' as const };
  return {
    priority: priority?.state === 'RECOGNIZED' ? String(priority.value) : basePriority,
    route: route.type,
    policyId:
      route.type === 'ESCALATION_POLICY'
        ? route.policyId
        : route.type === 'NO_ESCALATION'
          ? null
          : defaultPolicyId,
  };
}

/**
 * SHADOW: re-runs the already-loaded version on the noise-first inputs. Pure (no query), cached version
 * only, bounded by the same 15 ms budget. Null when there is nothing comparable (no version, fallback,
 * version evicted, timeout).
 */
export function reevaluateNoiseFirst(
  runtime: RuntimeEvaluation | null,
  envelope: IntegrationEventEnvelope,
  classification: { priority: string | null; urgency: string }
): Evaluation | null {
  if (!runtime?.versionId || runtime.fallbackReason) return null;
  const version = getCachedCompiledVersion(runtime.versionId);
  if (!version) return null;
  const started = performance.now();
  const guard = () => {
    if (performance.now() - started > LIMITS.evaluationMs) throw new Error('EVALUATION_TIMEOUT');
  };
  try {
    const context: Context = extractContextWithProvenance({
      fields: version.fields,
      providerPayload: envelope.providerPayload,
      normalizedEvent: envelope.event,
      integrationType: envelope.integrationType,
    }).context;
    Object.assign(
      context,
      builtinContext({
        ...classification,
        severity: envelope.event.payload.severity,
        integrationType: envelope.integrationType,
        source: envelope.event.payload.source,
      })
    );
    if (version.usesIntelligence)
      Object.assign(
        context,
        automationIntelligenceContext(envelope.serviceId, runtime.evaluationAt)
      );
    return evaluateAutomation({
      version,
      initialContext: context,
      evaluationAt: runtime.evaluationAt.toISOString(),
      guard,
      fieldsByKey: version.fieldsByKey,
    });
  } catch {
    return null;
  }
}

export type RerouteResult = {
  serviceId: string;
  serviceName?: string;
  applied: boolean;
  reason:
    | 'APPLIED'
    | 'AUTOMATION_NOT_LIVE'
    | 'AUTOMATION_ROUTE_RULE'
    | 'TARGET_HAS_NO_POLICY'
    | 'POLICY_MISSING';
  policyId?: string;
};

/**
 * Whether an orchestration REROUTE_SERVICE can replace this automation outcome: only a LIVE evaluation
 * that fell to the service default without a matching route rule. A service's own route rule (including
 * an explicit "use service default" or "no escalation") wins over a policy-wide orchestration rule.
 */
export function rerouteBlocker(runtime: RuntimeEvaluation | null): RerouteResult['reason'] | null {
  if (!runtime || runtime.mode !== 'LIVE' || !runtime.result || runtime.fallbackReason)
    return 'AUTOMATION_NOT_LIVE';
  if (runtime.result.outcome.type !== 'SERVICE_DEFAULT' || runtime.result.matchedRule)
    return 'AUTOMATION_ROUTE_RULE';
  return null;
}

/**
 * ON: applies REROUTE_SERVICE through the automation route: the incident is pinned to the target service's
 * escalation policy exactly as an automation ESCALATION_POLICY route is (decision row, responder snapshot),
 * so the first page and every later escalation step follow it. Two bounded reads, ON only.
 */
export async function applyOrchestrationReroute(
  tx: Prisma.TransactionClient,
  runtime: RuntimeEvaluation | null,
  serviceId: string
): Promise<RerouteResult> {
  const blocked = rerouteBlocker(runtime);
  if (blocked) return { serviceId, applied: false, reason: blocked };
  const target = await tx.service.findUnique({
    where: { id: serviceId },
    select: { name: true, escalationPolicyId: true },
  });
  if (!target?.escalationPolicyId)
    return {
      serviceId,
      serviceName: target?.name,
      applied: false,
      reason: 'TARGET_HAS_NO_POLICY',
    };
  let snapshot: Awaited<ReturnType<typeof captureResponderSnapshot>> | null = null;
  try {
    snapshot = await captureResponderSnapshot(tx, target.escalationPolicyId);
  } catch (error) {
    // Database failures abort ingestion as everywhere else; an invalid policy just keeps the route.
    if (error instanceof Prisma.PrismaClientKnownRequestError) throw error;
    if (error instanceof Prisma.PrismaClientUnknownRequestError) throw error;
  }
  if (!snapshot)
    return { serviceId, serviceName: target.name, applied: false, reason: 'POLICY_MISSING' };
  const live = runtime!;
  live.result = { ...live.result!, outcome: { type: 'ESCALATION_POLICY', policyId: snapshot.id } };
  live.policyId = snapshot.id;
  live.policyName = snapshot.name;
  live.responderPolicy = snapshot;
  live.orchestration = {
    reroute: { serviceId, serviceName: target.name, policyId: snapshot.id },
  };
  return {
    serviceId,
    serviceName: target.name,
    applied: true,
    reason: 'APPLIED',
    policyId: snapshot.id,
  };
}
