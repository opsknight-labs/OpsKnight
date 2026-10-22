import { monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import type { EvaluationPosition } from './evaluator/guard';
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
import {
  buildResponseContext,
  responseContextFieldDefinitions,
  type ResponseContextFieldDefinition,
} from './response-context';
// Process-level historical delay context; it cannot measure an ongoing synchronous stall.
const evaluationLoopDelay = monitorEventLoopDelay({ resolution: 20 });
evaluationLoopDelay.enable();
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
  versionNumber: number | null;
  /** Declared fields of the evaluated version (builtins first); never raw payload paths. */
  contextFields: ResponseContextFieldDefinition[];
  evaluationAt: Date;
  durationMs: number;
  extractionMs: number;
  versionLoadMs: number;
  evaluatorMs: number;
  policyLookupMs: number;
  responderSnapshotMs: number;
  decisionPersistenceMs?: number;
  tracePersistenceMs?: number;
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
  classification: { priority: string | null; urgency: string },
  defaultPolicy?: { id: string; name: string } | null
): Promise<RuntimeEvaluation | null> {
  const config = await getIngestionAutomationConfig(tx, envelope.serviceId);
  if (!config || config.mode === 'DISABLED') return null;
  const evaluationAt = envelope.receivedAt;
  const runtime: RuntimeEvaluation = {
    mode: config.mode,
    versionId: config.activeVersionId,
    versionNumber: null,
    contextFields: [],
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
  const defaultPolicyLookupStarted = performance.now();
  const servicePolicy =
    defaultPolicy !== undefined
      ? defaultPolicy
      : (
          await tx.service.findUnique({
            where: { id: envelope.serviceId },
            select: { policy: { select: { id: true, name: true } } },
          })
        )?.policy ?? null;
  runtime.policyLookupMs = performance.now() - defaultPolicyLookupStarted;
  const engineStartedAt = performance.now();
  try {
    const versionLoadStart = performance.now();
    if (!config.activeVersionId) throw new Error('VERSION_MISSING');
    const cached = getCachedCompiledVersion(config.activeVersionId);
    const stored = cached
      ? null
      : await tx.automationVersion.findUnique({
          where: { id: config.activeVersionId },
          select: { id: true, compiledSnapshot: true, checksum: true, versionNumber: true },
        });
    if (!cached && !stored) throw new Error('VERSION_MISSING');
    const loaded = cached ?? loadCompiledVersion(stored!);
    const version = loaded.compiled;
    runtime.versionNumber = loaded.versionNumber;
    runtime.contextFields = responseContextFieldDefinitions(version);
    runtime.versionLoadMs = performance.now() - versionLoadStart;
    let timeoutPosition: EvaluationPosition = {
      phase: 'EXTRACTION',
      ruleIndex: null,
      conditionIndex: null,
    };
    const phaseDurations = new Map<string, number>();
    let phaseStarted = 0;
    let guardCheckCounter = 0;
    const guard = (position?: EvaluationPosition) => {
      const isPhaseChange = position && position.phase !== timeoutPosition.phase;
      const prevPhase = timeoutPosition.phase;
      if (position) timeoutPosition = position;
      if (isPhaseChange || !position || (++guardCheckCounter & 3) === 0) {
        const now = performance.now();
        if (isPhaseChange) {
          phaseDurations.set(
            prevPhase,
            (phaseDurations.get(prevPhase) ?? 0) + now - phaseStarted
          );
          phaseStarted = now;
        }
        const elapsedMs = now - evalStart;
        const evaluationTimeoutLimit =
          Number(process.env.AUTOMATION_EVALUATION_TIMEOUT_MS) || LIMITS.evaluationMs;
        if (elapsedMs > evaluationTimeoutLimit) {
          logger.warn('automation.evaluation_timeout', {
            ...timeoutPosition,
            elapsedMs,
            fieldCount: version.fields.length,
            ruleCount: version.rules.length,
            heapUsed: process.memoryUsage().heapUsed,
            phaseDurationsMs: Object.fromEntries([
              ...phaseDurations,
              [timeoutPosition.phase, now - phaseStarted],
            ]),
            processCpuDeltaMs: (() => {
              const cpu = process.cpuUsage(evalCpuStart);
              return (cpu.user + cpu.system) / 1000;
            })(),
            priorObservedEventLoopDelayMaxMs: evaluationLoopDelay.max
              ? evaluationLoopDelay.max / 1e6
              : null,
          });
          throw new Error('EVALUATION_TIMEOUT');
        }
      }
    };
    const evalCpuStart = process.cpuUsage();
    const evalStart = performance.now();
    phaseStarted = evalStart;
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
      fieldsByKey: loaded.fieldsByKey,
    });
    runtime.evaluatorMs = performance.now() - pureEvalStart;
    guard();
    const policyLookupStart = performance.now();
    let policy: { id: string; name: string } | null = null;
    if (result.outcome.type === 'ESCALATION_POLICY') {
      if (runtime.mode === 'LIVE') {
        policy = { id: result.outcome.policyId, name: '' };
      } else {
        policy = await tx.escalationPolicy.findUnique({
          where: { id: result.outcome.policyId },
          select: { id: true, name: true },
        });
        if (!policy) throw new Error('POLICY_MISSING');
      }
    } else {
      policy = servicePolicy;
    }
    runtime.policyLookupMs += performance.now() - policyLookupStart;
    runtime.result = result;
    runtime.policyId = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.id ?? null);
    runtime.policyName = result.outcome.type === 'NO_ESCALATION' ? null : (policy?.name ?? null);
    const priority = result.enrichedContext.priority;
    runtime.finalPriority =
      config.mode === 'LIVE' && priority?.state === 'RECOGNIZED'
        ? String(priority.value)
        : classification.priority;
    const effectivePolicyId =
      runtime.mode === 'LIVE' ? runtime.policyId : (servicePolicy?.id ?? null);
    if (effectivePolicyId) {
      const snapshotStart = performance.now();
      runtime.responderPolicy = await captureResponderSnapshot(tx, effectivePolicyId);
      if (runtime.mode === 'LIVE' && !runtime.responderPolicy) throw new Error('POLICY_MISSING');
      if (runtime.mode === 'LIVE') {
        runtime.policyName = runtime.responderPolicy?.name ?? null;
      }
      runtime.responderSnapshotMs = performance.now() - snapshotStart;
    }
    // Bounded safe scalar summaries are queued; observation writes occur in the general worker.
    // Unmapped observations are always recorded to alert operators immediately.
    // In production, mapped observations and provider discoveries are sampled (5%) to prevent DB write saturation.
    const hasUnmapped = extracted.normalization.some(n => n.canonical.state === 'UNMAPPED');
    const isSample = process.env.NODE_ENV === 'test' || hasUnmapped || Math.random() < 0.05;
    const configuredObservations = extracted.normalization
      .filter(n => n.raw !== null && (n.canonical.state === 'UNMAPPED' || isSample))
      .map(n => ({
        key: n.fieldKey,
        path: n.sourcePath ?? n.fieldKey,
        value: String(n.raw).slice(0, 256),
        type: version.fields.find(f => f.key === n.fieldKey)?.type ?? 'STRING',
        unmapped: n.canonical.state === 'UNMAPPED',
        source: n.source ?? (envelope.integrationType === 'EVENTS_API' ? 'EVENT' : 'PROVIDER'),
      }));
    const observedKeys = new Set(
      configuredObservations.map(field => `${field.source ?? 'PROVIDER'}:${field.path}`)
    );
    const discoveredProviderObservations = isSample
      ? discoverFields(envelope.providerPayload)
          .map(field => ({ ...field, source: 'PROVIDER' as const }))
          .filter(field => !observedKeys.has(`PROVIDER:${field.path}`))
      : [];
    runtime.observations = [...configuredObservations, ...discoveredProviderObservations].slice(
      0,
      LIMITS.fields
    );
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
    const normalizedReason =
      reason === 'Pinned escalation policy is missing' ? 'POLICY_MISSING' : reason;
    runtime.fallbackReason = [
      'VERSION_MISSING',
      'VERSION_INVALID',
      'EXTRACTION_LIMIT',
      'CONTEXT_FIELD_LIMIT',
      'EVALUATION_TIMEOUT',
      'POLICY_MISSING',
    ].includes(normalizedReason)
      ? normalizedReason
      : 'VERSION_INVALID';
    runtime.result = null;
    runtime.normalization = [];
    runtime.observations = [];
    runtime.finalPriority = classification.priority;
    runtime.policyId = servicePolicy?.id ?? null;
    runtime.policyName = servicePolicy?.name ?? null;
    // Snapshot validation belongs before incident creation/final-priority/SLA writes.
    // If even the default policy is invalid, keep legacy default routing available
    // rather than making a diagnostic snapshot prevent alert acceptance.
    if (runtime.mode === 'LIVE') {
      try {
        runtime.responderPolicy = runtime.policyId
          ? await captureResponderSnapshot(tx, runtime.policyId)
          : null;
        runtime.policyName = runtime.responderPolicy?.name ?? null;
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

function compactSummaryWrites(writes: Array<{ fieldKey: string; value: unknown }> | undefined) {
  if (!writes || !writes.length) return [];
  const seen = new Set<string>();
  const compact: Array<{ fieldKey: string; value: unknown }> = [];
  for (const w of writes) {
    const key = `${w.fieldKey}:${String(w.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    compact.push({ fieldKey: w.fieldKey, value: w.value });
    if (compact.length >= LIMITS.fields) break;
  }
  return compact;
}

export async function persistAutomation(
  tx: Prisma.TransactionClient,
  incidentId: string,
  envelope: IntegrationEventEnvelope,
  runtime: RuntimeEvaluation | null,
  operationalActions = true,
  defaultEscalationPolicyId?: string | null
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
    const escalationPolicyId =
      defaultEscalationPolicyId !== undefined
        ? defaultEscalationPolicyId
        : (
            await tx.service.findUnique({
              where: { id: envelope.serviceId },
              select: { escalationPolicyId: true },
            })
          )?.escalationPolicyId;
    const routeDifferent =
      !!result &&
      (result.outcome.type === 'NO_ESCALATION' ||
        (result.outcome.type === 'ESCALATION_POLICY' &&
          result.outcome.policyId !== escalationPolicyId));
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
  const fullDetail = () => ({
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
  });

  let summary: unknown = null;
  let responseContext: unknown = null;

  const useRawCte = typeof tx.$executeRaw === 'function';

  if (runtime.mode === 'LIVE') {
    const responderPolicy = runtime.responderPolicy;
    summary = encodeExplanation(
      {
        ...(responderPolicy === undefined ? { snapshotUnavailable: true } : { responderPolicy }),
        normalization: runtime.normalization,
        inputContext: result?.inputContext ?? {},
        enrichedContext: result?.enrichedContext ?? {},
        writes: compactSummaryWrites(result?.writes),
        supplementalActions: result?.supplementalActions ?? [],
        outcome: result?.outcome ?? { type: 'SERVICE_DEFAULT' },
      },
      MAX_AUTOMATION_DECISION_BYTES
    );
    runtime.decisionBytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
    // Only an intact LIVE evaluation may hand context to downstream consumers (runbooks).
    responseContext =
      result && runtime.versionId && runtime.versionNumber !== null && !runtime.fallbackReason
        ? buildResponseContext({
            versionId: runtime.versionId,
            versionNumber: runtime.versionNumber,
            fields: runtime.contextFields,
            inputContext: result.inputContext,
            enrichedContext: result.enrichedContext,
          })
        : null;

    if (result?.tags.length && !useRawCte) {
      let loaded = await tx.tag.findMany({
        where: { name: { in: result.tags } },
        select: { id: true, name: true },
      });
      if (loaded.length < result.tags.length) {
        const existingNames = new Set(loaded.map(t => t.name));
        const missing = result.tags.filter(name => !existingNames.has(name));
        if (missing.length) {
          await tx.tag.createMany({
            data: missing.map(name => ({ name })),
            skipDuplicates: true,
          });
          loaded = await tx.tag.findMany({
            where: { name: { in: result.tags } },
            select: { id: true, name: true },
          });
        }
      }
      if (loaded.length) {
        await tx.incidentTag.createMany({
          data: loaded.map(tag => ({ incidentId, tagId: tag.id })),
          skipDuplicates: true,
        });
      }
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

  const encodedDetail = encodeExplanation(
    runtime.fallbackReason ||
      runtime.normalization.some(field => field.canonical.state === 'UNMAPPED') ||
      incidentId.charCodeAt(incidentId.length - 1) % 20 === 0
      ? { ...fullDetail(), diagnosticLevel: 'FULL' }
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
  );
  if (encodedDetail.diagnosticLevel === 'FULL')
    runtime.detailedTraceBytes = Buffer.byteLength(JSON.stringify(encodedDetail), 'utf8');

  const hasBackgroundJob = Boolean(runtime.observations.length || shadow);
  const jobPayload = hasBackgroundJob
    ? asJson({
        task: 'AUTOMATION_OBSERVE',
        logicalKey: `AUTOMATION_OBSERVE:${incidentId}`,
        serviceId: envelope.serviceId,
        integrationId: envelope.integrationId,
        integrationType: envelope.integrationType,
        observations: runtime.observations.map(o => ({
          key: o.key,
          path: o.path,
          value: o.value,
          type: o.type,
          unmapped: o.unmapped,
          ...(o.source ? { source: o.source } : {}),
        })),
        ...(shadow ? { shadow } : {}),
      })
    : null;

  if (useRawCte) {
    const traceId = randomUUID();
    const jobId = `AUTOMATION_OBSERVE:${incidentId}`;
    const rawStarted = performance.now();

    if (runtime.mode === 'LIVE') {
      const summaryJson = JSON.stringify(summary);
      const responseContextJson = responseContext ? JSON.stringify(responseContext) : null;
      const detailJson = JSON.stringify(encodedDetail);
      const tags = result?.tags ?? [];

      if (hasBackgroundJob) {
        const jobJson = JSON.stringify(jobPayload);
        if (tags.length) {
          await tx.$executeRaw(Prisma.sql`
            WITH ins_tags_def AS (
              INSERT INTO "Tag" ("id", "name")
              SELECT gen_random_uuid()::text, name
              FROM unnest(${tags}::text[]) AS name
              ON CONFLICT ("name") DO NOTHING
              RETURNING id, name
            ),
            all_tags AS (
              SELECT id FROM ins_tags_def
              UNION
              SELECT id FROM "Tag" WHERE name = ANY(${tags}::text[])
            ),
            ins_tags AS (
              INSERT INTO "IncidentTag" ("id", "incidentId", "tagId")
              SELECT gen_random_uuid()::text, ${incidentId}, id FROM all_tags
              ON CONFLICT ("incidentId", "tagId") DO NOTHING
            ),
            ins_decision AS (
              INSERT INTO "IncidentAutomationDecision" (
                "incidentId", "serviceId", "versionId", "mode", "routeType",
                "escalationPolicyId", "escalationPolicyNameSnapshot",
                "matchedRouteRuleId", "matchedRouteRuleName",
                "basePriority", "finalPriority", "evaluationAt", "fallbackReason",
                "summary", "responseContext", "createdAt"
              ) VALUES (
                ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode",
                ${(result?.outcome.type ?? 'SERVICE_DEFAULT')}::"AutomationRouteType",
                ${runtime.policyId ?? null}, ${runtime.policyName ?? null},
                ${result?.matchedRule?.id ?? null}, ${result?.matchedRule?.name ?? null},
                ${runtime.basePriority ?? null}, ${runtime.finalPriority ?? null},
                ${runtime.evaluationAt}, ${runtime.fallbackReason ?? null},
                ${summaryJson}::jsonb,
                ${responseContextJson}::jsonb,
                NOW()
              )
            ),
            ins_trace AS (
              INSERT INTO "AutomationTrace" (
                "id", "incidentId", "serviceId", "versionId", "mode", "phase",
                "evaluationAt", "durationMs", "fallbackReason", "detail"
              ) VALUES (
                ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode", 'INITIAL',
                ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
                ${detailJson}::jsonb
              )
            )
            INSERT INTO "BackgroundJob" (
              "id", "type", "scheduledAt", "payload", "maxAttempts", "createdAt", "updatedAt"
            ) VALUES (
              ${jobId}, 'SCHEDULED_TASK'::"JobType", ${runtime.evaluationAt},
              ${jobJson}::jsonb, 3, NOW(), NOW()
            );
          `);
        } else {
          await tx.$executeRaw(Prisma.sql`
            WITH ins_decision AS (
              INSERT INTO "IncidentAutomationDecision" (
                "incidentId", "serviceId", "versionId", "mode", "routeType",
                "escalationPolicyId", "escalationPolicyNameSnapshot",
                "matchedRouteRuleId", "matchedRouteRuleName",
                "basePriority", "finalPriority", "evaluationAt", "fallbackReason",
                "summary", "responseContext", "createdAt"
              ) VALUES (
                ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode",
                ${(result?.outcome.type ?? 'SERVICE_DEFAULT')}::"AutomationRouteType",
                ${runtime.policyId ?? null}, ${runtime.policyName ?? null},
                ${result?.matchedRule?.id ?? null}, ${result?.matchedRule?.name ?? null},
                ${runtime.basePriority ?? null}, ${runtime.finalPriority ?? null},
                ${runtime.evaluationAt}, ${runtime.fallbackReason ?? null},
                ${summaryJson}::jsonb,
                ${responseContextJson}::jsonb,
                NOW()
              )
            ),
            ins_trace AS (
              INSERT INTO "AutomationTrace" (
                "id", "incidentId", "serviceId", "versionId", "mode", "phase",
                "evaluationAt", "durationMs", "fallbackReason", "detail"
              ) VALUES (
                ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode", 'INITIAL',
                ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
                ${detailJson}::jsonb
              )
            )
            INSERT INTO "BackgroundJob" (
              "id", "type", "scheduledAt", "payload", "maxAttempts", "createdAt", "updatedAt"
            ) VALUES (
              ${jobId}, 'SCHEDULED_TASK'::"JobType", ${runtime.evaluationAt},
              ${jobJson}::jsonb, 3, NOW(), NOW()
            );
          `);
        }
      } else {
        if (tags.length) {
          await tx.$executeRaw(Prisma.sql`
            WITH ins_tags_def AS (
              INSERT INTO "Tag" ("id", "name")
              SELECT gen_random_uuid()::text, name
              FROM unnest(${tags}::text[]) AS name
              ON CONFLICT ("name") DO NOTHING
              RETURNING id, name
            ),
            all_tags AS (
              SELECT id FROM ins_tags_def
              UNION
              SELECT id FROM "Tag" WHERE name = ANY(${tags}::text[])
            ),
            ins_tags AS (
              INSERT INTO "IncidentTag" ("id", "incidentId", "tagId")
              SELECT gen_random_uuid()::text, ${incidentId}, id FROM all_tags
              ON CONFLICT ("incidentId", "tagId") DO NOTHING
            ),
            ins_decision AS (
              INSERT INTO "IncidentAutomationDecision" (
                "incidentId", "serviceId", "versionId", "mode", "routeType",
                "escalationPolicyId", "escalationPolicyNameSnapshot",
                "matchedRouteRuleId", "matchedRouteRuleName",
                "basePriority", "finalPriority", "evaluationAt", "fallbackReason",
                "summary", "responseContext", "createdAt"
              ) VALUES (
                ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode",
                ${(result?.outcome.type ?? 'SERVICE_DEFAULT')}::"AutomationRouteType",
                ${runtime.policyId ?? null}, ${runtime.policyName ?? null},
                ${result?.matchedRule?.id ?? null}, ${result?.matchedRule?.name ?? null},
                ${runtime.basePriority ?? null}, ${runtime.finalPriority ?? null},
                ${runtime.evaluationAt}, ${runtime.fallbackReason ?? null},
                ${summaryJson}::jsonb,
                ${responseContextJson}::jsonb,
                NOW()
              )
            )
            INSERT INTO "AutomationTrace" (
              "id", "incidentId", "serviceId", "versionId", "mode", "phase",
              "evaluationAt", "durationMs", "fallbackReason", "detail"
            ) VALUES (
              ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
              ${runtime.mode}::"AutomationMode", 'INITIAL',
              ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
              ${detailJson}::jsonb
            );
          `);
        } else {
          await tx.$executeRaw(Prisma.sql`
            WITH ins_decision AS (
              INSERT INTO "IncidentAutomationDecision" (
                "incidentId", "serviceId", "versionId", "mode", "routeType",
                "escalationPolicyId", "escalationPolicyNameSnapshot",
                "matchedRouteRuleId", "matchedRouteRuleName",
                "basePriority", "finalPriority", "evaluationAt", "fallbackReason",
                "summary", "responseContext", "createdAt"
              ) VALUES (
                ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
                ${runtime.mode}::"AutomationMode",
                ${(result?.outcome.type ?? 'SERVICE_DEFAULT')}::"AutomationRouteType",
                ${runtime.policyId ?? null}, ${runtime.policyName ?? null},
                ${result?.matchedRule?.id ?? null}, ${result?.matchedRule?.name ?? null},
                ${runtime.basePriority ?? null}, ${runtime.finalPriority ?? null},
                ${runtime.evaluationAt}, ${runtime.fallbackReason ?? null},
                ${summaryJson}::jsonb,
                ${responseContextJson}::jsonb,
                NOW()
              )
            )
            INSERT INTO "AutomationTrace" (
              "id", "incidentId", "serviceId", "versionId", "mode", "phase",
              "evaluationAt", "durationMs", "fallbackReason", "detail"
            ) VALUES (
              ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
              ${runtime.mode}::"AutomationMode", 'INITIAL',
              ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
              ${detailJson}::jsonb
            );
          `);
        }
      }
      const elapsed = performance.now() - rawStarted;
      runtime.decisionPersistenceMs = elapsed / 2;
      runtime.tracePersistenceMs = elapsed / 2;
    } else {
      // SHADOW mode
      const detailJson = JSON.stringify(encodedDetail);
      if (hasBackgroundJob) {
        const jobJson = JSON.stringify(jobPayload);
        await tx.$executeRaw(Prisma.sql`
          WITH ins_trace AS (
            INSERT INTO "AutomationTrace" (
              "id", "incidentId", "serviceId", "versionId", "mode", "phase",
              "evaluationAt", "durationMs", "fallbackReason", "detail"
            ) VALUES (
              ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
              ${runtime.mode}::"AutomationMode", 'INITIAL',
              ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
              ${detailJson}::jsonb
            )
          )
          INSERT INTO "BackgroundJob" (
            "id", "type", "scheduledAt", "payload", "maxAttempts", "createdAt", "updatedAt"
          ) VALUES (
            ${jobId}, 'SCHEDULED_TASK'::"JobType", ${runtime.evaluationAt},
            ${jobJson}::jsonb, 3, NOW(), NOW()
          );
        `);
      } else {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AutomationTrace" (
            "id", "incidentId", "serviceId", "versionId", "mode", "phase",
            "evaluationAt", "durationMs", "fallbackReason", "detail"
          ) VALUES (
            ${traceId}, ${incidentId}, ${envelope.serviceId}, ${runtime.versionId},
            ${runtime.mode}::"AutomationMode", 'INITIAL',
            ${runtime.evaluationAt}, ${runtime.durationMs}, ${runtime.fallbackReason ?? null},
            ${detailJson}::jsonb
          );
        `);
      }
      runtime.tracePersistenceMs = performance.now() - rawStarted;
    }
  } else {
    // Fallback path for unit test mocks where $executeRaw is not available
    const writes: Promise<unknown>[] = [];

    if (runtime.mode === 'LIVE') {
      const decisionPersistenceStarted = performance.now();
      writes.push(
        tx.incidentAutomationDecision
          .create({
            select: { incidentId: true },
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
              summary: summary as any,
              ...(responseContext ? { responseContext: responseContext as any } : {}),
            },
          })
          .then(() => {
            runtime.decisionPersistenceMs = performance.now() - decisionPersistenceStarted;
          })
      );
    }
    const tracePersistenceStarted = performance.now();
    writes.push(
      tx.automationTrace
        .create({
          select: { id: true },
          data: {
            incidentId,
            serviceId: envelope.serviceId,
            versionId: runtime.versionId,
            mode: runtime.mode,
            evaluationAt: runtime.evaluationAt,
            durationMs: runtime.durationMs,
            fallbackReason: runtime.fallbackReason,
            detail: encodedDetail as any,
          },
        })
        .then(() => {
          runtime.tracePersistenceMs = performance.now() - tracePersistenceStarted;
        })
    );
    if (hasBackgroundJob) {
      writes.push(
        tx.backgroundJob.create({
          select: { id: true },
          data: {
            id: `AUTOMATION_OBSERVE:${incidentId}`,
            type: 'SCHEDULED_TASK',
            scheduledAt: runtime.evaluationAt,
            payload: jobPayload as any,
            maxAttempts: 3,
          },
        })
      );
    }
    await Promise.all(writes);
  }
}
export function recordAutomationMetrics(runtime: RuntimeEvaluation | null) {
  if (!runtime) return;
  if (runtime.decisionPersistenceMs !== undefined)
    observeOperationalHistogram(
      'opsknight_automation_decision_persistence_ms',
      runtime.decisionPersistenceMs,
      {}
    );
  if (runtime.tracePersistenceMs !== undefined)
    observeOperationalHistogram(
      'opsknight_automation_trace_persistence_ms',
      runtime.tracePersistenceMs,
      {}
    );
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
