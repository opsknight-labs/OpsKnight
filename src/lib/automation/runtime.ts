import { getAutomationSettings } from './settings';
import type { Prisma } from '@prisma/client';
import type { EventPayload } from '@/lib/events';
import { logger } from '@/lib/logger';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { builtinContext } from './context/builtins';
import { LIMITS, type Context } from './contract';
import { extractContextWithProvenance } from './context/extract';
import { getCachedCompiledVersion, loadCompiledVersion } from './cache';
import { evaluateAutomation, type Evaluation } from './evaluator';
import { asJson } from './versioning';
import { discoverFields } from './discovery';
export const automationEnabled = async (client?: Prisma.TransactionClient) =>
  (await getAutomationSettings(client)).automationEnabled;
export type IntegrationEventEnvelope = {
  serviceId: string;
  integrationId: string;
  integrationType: string;
  event: EventPayload;
  providerPayload: unknown;
  receivedAt: Date;
};
export type RuntimeEvaluation = {
  mode: 'SHADOW' | 'LIVE';
  versionId: string | null;
  evaluationAt: Date;
  durationMs: number;
  extractionMs: number;
  result: Evaluation | null;
  fallbackReason: string | null;
  shadowDifferent: boolean;
  basePriority: string | null;
  finalPriority: string | null;
  policyId: string | null;
  policyName: string | null;
  observations: ReturnType<typeof discoverFields>;
  normalization: ReturnType<typeof extractContextWithProvenance>['normalization'];
};
export async function prepareAutomation(
  tx: Prisma.TransactionClient,
  envelope: IntegrationEventEnvelope,
  classification: { priority: string | null; urgency: string }
): Promise<RuntimeEvaluation | null> {
  if (!(await automationEnabled(tx))) return null;
  const config = await tx.serviceAutomationConfig.findUnique({
    where: { serviceId: envelope.serviceId },
    include: { activeVersion: { select: { id: true } } },
  });
  if (!config || config.mode === 'DISABLED') return null;
  const evaluationAt = envelope.receivedAt;
  const runtime: RuntimeEvaluation = {
    mode: config.mode,
    versionId: config.activeVersion?.id ?? null,
    evaluationAt,
    durationMs: 0,
    extractionMs: 0,
    result: null,
    fallbackReason: null,
    shadowDifferent: false,
    basePriority: classification.priority,
    finalPriority: classification.priority,
    policyId: null,
    policyName: null,
    observations: [],
    normalization: [],
  };
  // Load routing state once before invoking the evaluator. No condition performs IO.
  const service = await tx.service.findUnique({
    where: { id: envelope.serviceId },
    select: { policy: { select: { id: true, name: true } } },
  });
  const policies = config.activeVersion
    ? await tx.escalationPolicy.findMany({
        where: {
          id: {
            in: (
              await tx.automationVersionPolicyRef.findMany({
                where: { versionId: config.activeVersion.id },
                select: { escalationPolicyId: true },
              })
            ).map(r => r.escalationPolicyId),
          },
        },
        select: { id: true, name: true },
      })
    : [];
  const engineStartedAt = performance.now();
  try {
    if (!config.activeVersion) throw new Error('VERSION_MISSING');
    const cached = getCachedCompiledVersion(config.activeVersion.id);
    const stored = cached
      ? null
      : await tx.automationVersion.findUnique({
          where: { id: config.activeVersion.id },
          select: { id: true, compiledSnapshot: true, checksum: true },
        });
    if (!cached && !stored) throw new Error('VERSION_MISSING');
    const version = cached ?? loadCompiledVersion(stored!);
    const guard = () => {
      if (performance.now() - evalStart > LIMITS.evaluationMs)
        throw new Error('EVALUATION_TIMEOUT');
    };
    const evalStart = performance.now();
    const extractStart = performance.now();
    const extracted = extractContextWithProvenance({
      fields: version.fields,
      providerPayload: envelope.providerPayload,
      normalizedEvent: envelope.event,
      integrationType: envelope.integrationType,
    });
    const context: Context = extracted.context;
    runtime.normalization = extracted.normalization;
    runtime.extractionMs = performance.now() - extractStart;
    Object.assign(
      context,
      builtinContext({
        ...classification,
        severity: envelope.event.payload.severity,
        integrationType: envelope.integrationType,
        source: envelope.event.payload.source,
      })
    );
    guard();
    const result = evaluateAutomation({
      version,
      initialContext: context,
      evaluationAt: evaluationAt.toISOString(),
      guard,
    });
    guard();
    const policy =
      result.outcome.type === 'ESCALATION_POLICY'
        ? policies.find(p => p.id === (result.outcome as { policyId: string }).policyId)
        : service?.policy;
    if (result.outcome.type === 'ESCALATION_POLICY' && !policy) throw new Error('POLICY_MISSING');
    runtime.result = result;
    runtime.policyId = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.id ?? null);
    runtime.policyName = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.name ?? null);
    const priority = result.enrichedContext.priority;
    runtime.finalPriority =
      config.mode === 'LIVE' && priority?.state === 'RECOGNIZED'
        ? String(priority.value)
        : classification.priority;
    // Bounded safe scalar summaries are queued; observation writes occur in the general worker.
    const configuredObservations = extracted.normalization
      .filter(n => n.raw !== null)
      .map(n => ({
        key: n.fieldKey,
        path: n.sourcePath ?? n.fieldKey,
        value: String(n.raw).slice(0, 256),
        type: version.fields.find(f => f.key === n.fieldKey)?.type ?? 'STRING',
        unmapped: n.canonical.state === 'UNMAPPED',
      }));
    const observedPaths = new Set(configuredObservations.map(field => field.path));
    runtime.observations = [
      ...configuredObservations,
      ...discoverFields(envelope.providerPayload).filter(field => !observedPaths.has(field.path)),
    ].slice(0, LIMITS.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'VERSION_INVALID';
    runtime.fallbackReason = [
      'VERSION_MISSING',
      'VERSION_INVALID',
      'EXTRACTION_LIMIT',
      'CONTEXT_FIELD_LIMIT',
      'EVALUATION_TIMEOUT',
      'POLICY_MISSING',
    ].includes(reason)
      ? reason
      : 'VERSION_INVALID';
    runtime.result = null;
    runtime.normalization = [];
    runtime.observations = [];
    runtime.finalPriority = classification.priority;
    runtime.policyId = service?.policy?.id ?? null;
    runtime.policyName = service?.policy?.name ?? null;
  }
  runtime.durationMs = performance.now() - engineStartedAt;
  return runtime;
}
export async function persistAutomation(
  tx: Prisma.TransactionClient,
  incidentId: string,
  envelope: IntegrationEventEnvelope,
  runtime: RuntimeEvaluation | null,
  operationalActions = true
) {
  if (!runtime) return;
  const result = runtime.result;
  const actual = { priority: runtime.basePriority, route: 'SERVICE_DEFAULT' };
  const detail = {
    result: result
      ? {
          ...result,
          enrichmentRuleResults: result.enrichmentRuleResults.map(
            ({ terms: _terms, ...summary }) => summary
          ),
          routingRuleResults: result.routingRuleResults.map(
            ({ terms: _terms, ...summary }) => summary
          ),
        }
      : null,
    actual,
    fallbackReason: runtime.fallbackReason,
    normalization: runtime.normalization,
  };
  await tx.automationTrace.create({
    data: {
      incidentId,
      serviceId: envelope.serviceId,
      versionId: runtime.versionId,
      mode: runtime.mode,
      evaluationAt: runtime.evaluationAt,
      durationMs: runtime.durationMs,
      fallbackReason: runtime.fallbackReason,
      detail: asJson(detail),
    },
  });
  if (runtime.mode === 'SHADOW' && runtime.versionId) {
    const priority = result?.enrichedContext.priority;
    const priorityDifferent =
      priority?.state === 'RECOGNIZED' && priority.value !== runtime.basePriority;
    const service = await tx.service.findUnique({
      where: { id: envelope.serviceId },
      select: { escalationPolicyId: true },
    });
    const routeDifferent =
      !!result &&
      (result.outcome.type === 'NO_ESCALATION' ||
        (result.outcome.type === 'ESCALATION_POLICY' &&
          result.outcome.policyId !== service?.escalationPolicyId));
    const counts = {
      evaluated: 1,
      same: Number(!priorityDifferent && !routeDifferent && !runtime.fallbackReason),
      priorityDifferent: Number(priorityDifferent),
      routeDifferent: Number(routeDifferent),
      noEscalationDifferent: Number(result?.outcome.type === 'NO_ESCALATION'),
      errors: Number(!!runtime.fallbackReason),
      fallbacks: Number(!!runtime.fallbackReason),
    };
    runtime.shadowDifferent = priorityDifferent || routeDifferent || !!runtime.fallbackReason;
    const bucketDate = new Date(runtime.evaluationAt.toISOString().slice(0, 10));
    await tx.automationShadowAggregate.upsert({
      where: {
        serviceId_versionId_bucketDate: {
          serviceId: envelope.serviceId,
          versionId: runtime.versionId,
          bucketDate,
        },
      },
      create: {
        serviceId: envelope.serviceId,
        versionId: runtime.versionId,
        bucketDate,
        ...counts,
      },
      update: Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [key, { increment: value }])
      ),
    });
  }
  if (runtime.mode === 'LIVE') {
    await tx.incidentAutomationDecision.create({
      data: {
        incidentId,
        serviceId: envelope.serviceId,
        versionId: runtime.versionId,
        mode: 'LIVE',
        routeType: result?.outcome.type ?? 'SERVICE_DEFAULT',
        escalationPolicyId: runtime.policyId,
        escalationPolicyNameSnapshot: runtime.policyName,
        matchedRouteRuleId: result?.matchedRule?.id,
        matchedRouteRuleName: result?.matchedRule?.name,
        basePriority: runtime.basePriority,
        finalPriority: runtime.finalPriority,
        evaluationAt: runtime.evaluationAt,
        fallbackReason: runtime.fallbackReason,
        summary: asJson({
          normalization: runtime.normalization,
          inputContext: result?.inputContext ?? {},
          enrichedContext: result?.enrichedContext ?? {},
          writes: result?.writes ?? [],
          outcome: result?.outcome ?? { type: 'SERVICE_DEFAULT' },
        }),
      },
    });
    if (result?.tags.length) {
      await tx.tag.createMany({ data: result.tags.map(name => ({ name })), skipDuplicates: true });
      const tags = await tx.tag.findMany({
        where: { name: { in: result.tags } },
        select: { id: true },
      });
      await tx.incidentTag.createMany({
        data: tags.map(tag => ({ incidentId, tagId: tag.id })),
        skipDuplicates: true,
      });
    }
    if (operationalActions && runtime.versionId)
      for (const action of result?.supplementalActions ?? []) {
        const key = `AUTOMATION_NOTIFY:${incidentId}:${runtime.versionId}:${action.ruleId}:${action.provider}:${action.destinationId}`;
        await tx.backgroundJob.create({
          data: {
            id: key,
            type: 'SCHEDULED_TASK',
            scheduledAt: runtime.evaluationAt,
            payload: asJson({
              task: 'AUTOMATION_NOTIFY',
              incidentId,
              serviceId: envelope.serviceId,
              versionId: runtime.versionId,
              ...action,
              logicalKey: key,
            }),
            maxAttempts: 5,
          },
        });
      }
  }
  // Store bounded scalar discovery candidates, never provider payloads or headers.
  await tx.backgroundJob.create({
    data: {
      id: `AUTOMATION_OBSERVE:${incidentId}`,
      type: 'SCHEDULED_TASK',
      scheduledAt: runtime.evaluationAt,
      payload: asJson({
        task: 'AUTOMATION_OBSERVE',
        logicalKey: `AUTOMATION_OBSERVE:${incidentId}`,
        serviceId: envelope.serviceId,
        integrationId: envelope.integrationId,
        integrationType: envelope.integrationType,
        observations: runtime.observations,
      }),
      maxAttempts: 3,
    },
  });
}
export function recordAutomationMetrics(runtime: RuntimeEvaluation | null) {
  if (!runtime) return;
  addOperationalMetric('opsknight_automation_evaluations_total', 1, {
    mode: runtime.mode,
    outcome: runtime.result?.outcome.type ?? 'FALLBACK',
  });
  observeOperationalHistogram('opsknight_automation_evaluation_duration_ms', runtime.durationMs, {
    mode: runtime.mode,
  });
  observeOperationalHistogram(
    'opsknight_automation_extraction_duration_ms',
    runtime.extractionMs,
    {}
  );
  if (runtime.mode === 'SHADOW' && runtime.shadowDifferent)
    addOperationalMetric('opsknight_automation_shadow_difference_total', 1, {
      outcome: runtime.result?.outcome.type ?? 'FALLBACK',
    });
  if (runtime.fallbackReason)
    addOperationalMetric('opsknight_automation_fallback_total', 1, {
      fallback_reason: runtime.fallbackReason,
    });
  if (runtime.result)
    logger.info('automation.route.selected', {
      mode: runtime.mode,
      versionId: runtime.versionId,
      ruleId: runtime.result.matchedRule?.id,
      outcome: runtime.result.outcome.type,
    });
  logger.info(
    runtime.fallbackReason ? 'automation.evaluation.fallback' : 'automation.evaluation.completed',
    {
      mode: runtime.mode,
      versionId: runtime.versionId,
      fallbackReason: runtime.fallbackReason,
      durationMs: runtime.durationMs,
    }
  );
}
