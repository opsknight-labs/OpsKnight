import {
  encodeExplanation,
  MAX_AUTOMATION_DECISION_BYTES,
  MAX_AUTOMATION_TRACE_BYTES,
} from './explanation';
import { enqueueAutomationNotification } from './jobs';
import { getAutomationSettings, getIngestionAutomationConfig } from './settings';
import { Prisma } from '@prisma/client';
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
import { captureResponderSnapshot } from '@/lib/escalation/automation-snapshot';
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
  versionLoadMs: number;
  evaluatorMs: number;
  policyLookupMs: number;
  responderSnapshotMs: number;
  responderPolicy?: Awaited<ReturnType<typeof captureResponderSnapshot>> | null;
  result: Evaluation | null;
  fallbackReason: string | null;
  shadowDifferent: boolean;
  basePriority: string | null;
  finalPriority: string | null;
  policyId: string | null;
  policyName: string | null;
  detailedTraceBytes?: number;
  decisionBytes?: number;
  observations: ReturnType<typeof discoverFields>;
  normalization: ReturnType<typeof extractContextWithProvenance>['normalization'];
};
export async function prepareAutomation(
  tx: Prisma.TransactionClient,
  envelope: IntegrationEventEnvelope,
  classification: { priority: string | null; urgency: string }
): Promise<RuntimeEvaluation | null> {
  const config = await getIngestionAutomationConfig(tx, envelope.serviceId);
  if (!config || config.mode === 'DISABLED') return null;
  const evaluationAt = envelope.receivedAt;
  const runtime: RuntimeEvaluation = {
    mode: config.mode,
    versionId: config.activeVersionId,
    evaluationAt,
    durationMs: 0,
    extractionMs: 0,
    versionLoadMs: 0,
    evaluatorMs: 0,
    policyLookupMs: 0,
    responderSnapshotMs: 0,
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
  const engineStartedAt = performance.now();
  try {
    const versionLoadStart = performance.now();
    if (!config.activeVersionId) throw new Error('VERSION_MISSING');
    const cached = getCachedCompiledVersion(config.activeVersionId);
    const stored = cached
      ? null
      : await tx.automationVersion.findUnique({
          where: { id: config.activeVersionId },
          select: { id: true, compiledSnapshot: true, checksum: true },
        });
    if (!cached && !stored) throw new Error('VERSION_MISSING');
    const version = cached ?? loadCompiledVersion(stored!);
    runtime.versionLoadMs = performance.now() - versionLoadStart;
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
    const pureEvalStart = performance.now();
    const result = evaluateAutomation({
      version,
      initialContext: context,
      evaluationAt: evaluationAt.toISOString(),
      guard,
    });
    runtime.evaluatorMs = performance.now() - pureEvalStart;
    guard();
    const policyLookupStart = performance.now();
    const policy =
      result.outcome.type === 'ESCALATION_POLICY'
        ? await tx.escalationPolicy.findUnique({
            where: { id: result.outcome.policyId },
            select: { id: true, name: true },
          })
        : service?.policy;
    runtime.policyLookupMs = performance.now() - policyLookupStart;
    if (result.outcome.type === 'ESCALATION_POLICY' && !policy) throw new Error('POLICY_MISSING');
    runtime.result = result;
    runtime.policyId = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.id ?? null);
    runtime.policyName = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.name ?? null);
    const priority = result.enrichedContext.priority;
    runtime.finalPriority =
      config.mode === 'LIVE' && priority?.state === 'RECOGNIZED'
        ? String(priority.value)
        : classification.priority;
    if (runtime.mode === 'LIVE') {
      const snapshotStart = performance.now();
      runtime.responderPolicy = runtime.policyId
        ? await captureResponderSnapshot(tx, runtime.policyId)
        : null;
      runtime.responderSnapshotMs = performance.now() - snapshotStart;
    }
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
    // Database failures must abort ingestion and use the transaction/replay path,
    // never silently commit a different responder route as an engine fallback.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError
    )
      throw error;
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
    // Snapshot validation belongs before incident creation/final-priority/SLA writes.
    // If even the default policy is invalid, keep legacy default routing available
    // rather than making a diagnostic snapshot prevent alert acceptance.
    if (runtime.mode === 'LIVE') {
      try {
        runtime.responderPolicy = runtime.policyId
          ? await captureResponderSnapshot(tx, runtime.policyId)
          : null;
      } catch (snapshotError) {
        if (
          snapshotError instanceof Prisma.PrismaClientKnownRequestError ||
          snapshotError instanceof Prisma.PrismaClientUnknownRequestError ||
          snapshotError instanceof Prisma.PrismaClientInitializationError
        )
          throw snapshotError;
        runtime.responderPolicy = undefined;
      }
    }
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
  const destinationNames: Array<{ provider: string; destinationId: string; label: string }> = [];
  const actual = { priority: runtime.basePriority, route: 'SERVICE_DEFAULT' };
  let shadow:
    | {
        versionId: string;
        bucketDate: string;
        evaluated: number;
        same: number;
        priorityDifferent: number;
        routeDifferent: number;
        noEscalationDifferent: number;
        errors: number;
        fallbacks: number;
      }
    | undefined;
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
    shadow = { versionId: runtime.versionId, bucketDate: bucketDate.toISOString(), ...counts };
  }
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
    shadowDifferent: runtime.shadowDifferent,
    normalization: runtime.normalization,
    policyName: runtime.policyName,
    destinationNames,
  };
  if (runtime.mode === 'LIVE') {
    const responderPolicy = runtime.responderPolicy;
    const summary = encodeExplanation(
      {
        ...(responderPolicy === undefined ? { snapshotUnavailable: true } : { responderPolicy }),
        normalization: runtime.normalization,
        inputContext: result?.inputContext ?? {},
        enrichedContext: result?.enrichedContext ?? {},
        writes: result?.writes ?? [],
        outcome: result?.outcome ?? { type: 'SERVICE_DEFAULT' },
      },
      MAX_AUTOMATION_DECISION_BYTES
    );
    runtime.decisionBytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
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
        summary,
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
        const destination = await enqueueAutomationNotification(tx, {
          task: 'AUTOMATION_NOTIFY',
          incidentId,
          serviceId: envelope.serviceId,
          versionId: runtime.versionId,
          ...action,
          logicalKey: key,
        });
        if (destination) destinationNames.push(destination);
      }
  }
  const trace = await tx.automationTrace.create({
    data: {
      incidentId,
      serviceId: envelope.serviceId,
      versionId: runtime.versionId,
      mode: runtime.mode,
      evaluationAt: runtime.evaluationAt,
      durationMs: runtime.durationMs,
      fallbackReason: runtime.fallbackReason,
      detail: encodeExplanation(
        runtime.shadowDifferent ||
          runtime.fallbackReason ||
          runtime.normalization.some(field => field.canonical.state === 'UNMAPPED') ||
          incidentId.charCodeAt(incidentId.length - 1) % 20 === 0
          ? { ...detail, diagnosticLevel: 'FULL' }
          : {
              diagnosticLevel: 'COMPACT',
              policyName: runtime.policyName,
              destinationNames,
              actual,
              fallbackReason: runtime.fallbackReason,
              shadowDifferent: runtime.shadowDifferent,
              normalization: runtime.normalization.filter(n => n.canonical.state === 'UNMAPPED'),
              result: result
                ? {
                    outcome: result.outcome,
                    matchedRule: result.matchedRule,
                    enrichedContext: { priority: result.enrichedContext.priority },
                    tags: result.tags,
                    supplementalActions: result.supplementalActions,
                  }
                : null,
            },
        MAX_AUTOMATION_TRACE_BYTES
      ),
    },
  });
  if (
    trace?.detail &&
    typeof trace.detail === 'object' &&
    !Array.isArray(trace.detail) &&
    'diagnosticLevel' in trace.detail &&
    trace.detail.diagnosticLevel === 'FULL'
  )
    runtime.detailedTraceBytes = Buffer.byteLength(JSON.stringify(trace.detail), 'utf8');
  // Store bounded scalar discovery candidates, never provider payloads or headers.
  if (runtime.observations.length || shadow)
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
          ...(shadow ? { shadow } : {}),
        }),
        maxAttempts: 3,
      },
    });
}
export function recordAutomationMetrics(runtime: RuntimeEvaluation | null) {
  if (!runtime) return;
  if (runtime.decisionBytes !== undefined)
    observeOperationalHistogram('opsknight_automation_decision_bytes', runtime.decisionBytes, {});
  if (runtime.detailedTraceBytes)
    addOperationalMetric(
      'opsknight_automation_detailed_trace_bytes_total',
      runtime.detailedTraceBytes,
      {}
    );
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
  observeOperationalHistogram('opsknight_automation_version_load_ms', runtime.versionLoadMs, {});
  observeOperationalHistogram('opsknight_automation_evaluator_ms', runtime.evaluatorMs, {});
  observeOperationalHistogram('opsknight_automation_policy_lookup_ms', runtime.policyLookupMs, {});
  if (runtime.responderSnapshotMs > 0) {
    observeOperationalHistogram(
      'opsknight_automation_responder_snapshot_ms',
      runtime.responderSnapshotMs,
      {}
    );
  }
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
