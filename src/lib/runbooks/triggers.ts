import 'server-only';

import prisma from '@/lib/prisma';
import { computeTriggerFingerprint } from './definition';
import { evaluateTrigger } from './matcher';
import { loadRunbookIncidentContext } from './incident-context';
import { startTriggeredRunbookExecution } from './orchestrator';
import { RunbookArchivedError, RunbookDefinitionError, RunbookError } from './errors';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import { resolveBindingAutomationPlan } from './automation-binding';
import { lockRunbookForShare } from './locking';
import type { Prisma } from '@prisma/client';

export type TriggerEvaluationSource = 'MONITORING' | 'MANUAL';

const MONITORING_SOURCES = new Set(['MONITORING', 'EVENT', 'ALERT', 'INTEGRATION']);

export function normalizeEvaluationSource(raw: unknown): TriggerEvaluationSource | null {
  if (typeof raw !== 'string' || !raw) return null;
  return MONITORING_SOURCES.has(raw.toUpperCase()) ? 'MONITORING' : 'MANUAL';
}

/** Without an explicit job source, an alert-linked incident is treated as monitoring-sourced. */
async function resolveEvaluationSource(
  incidentId: string,
  raw: unknown
): Promise<TriggerEvaluationSource> {
  const normalized = normalizeEvaluationSource(raw);
  if (normalized) return normalized;
  const alerts = await prisma.alert.count({ where: { incidentId } });
  return alerts > 0 ? 'MONITORING' : 'MANUAL';
}

/** Actionable audit: at most one skip event per binding, reason and incident, across retries. */
async function recordRunbookSkip(input: {
  incidentId: string;
  bindingId: string;
  runbookName: string;
  reason: string;
}) {
  const message = `Runbook skipped: ${input.runbookName}: ${input.reason}`.slice(0, 2000);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-skip:${input.bindingId}:${input.incidentId}`}))`;
    const existing = await tx.incidentEvent.findFirst({
      where: { incidentId: input.incidentId, type: 'RUNBOOK_SKIPPED', message },
      select: { id: true },
    });
    if (existing) return;
    await tx.incidentEvent.create({
      data: { incidentId: input.incidentId, type: 'RUNBOOK_SKIPPED', message },
    });
  });
}

const isAlreadyHandled = (error: unknown) =>
  (error as { code?: string })?.code === 'P2002' ||
  (error instanceof RunbookDefinitionError && error.message.includes('TRIGGER_ALREADY_HANDLED'));

export async function evaluateIncidentTriggers(
  incidentId: string,
  sourceEventId: string,
  options: { source?: unknown } = {}
) {
  const loaded = await loadRunbookIncidentContext(prisma, incidentId);
  if (!loaded) return { matched: 0, started: 0, suggested: 0 };
  // The job runs after commit; an incident closed in between must not start remediation.
  if (loaded.trigger.incident.status !== 'OPEN') return { matched: 0, started: 0, suggested: 0 };
  const context = loaded.trigger;
  const serviceId = context.service.id;
  const evaluationSource = await resolveEvaluationSource(incidentId, options.source);
  const bindings = await prisma.serviceRunbookBinding.findMany({
    where: {
      serviceId,
      enabled: true,
      mode: { in: ['SUGGESTED', 'AUTOMATIC'] },
      runbook: { archivedAt: null },
      triggers: { some: { enabled: true, event: 'INCIDENT_CREATED' } },
      ...(evaluationSource === 'MONITORING' ? { runOnMonitoringIncidents: true } : {}),
    },
    include: {
      runbook: { select: { name: true, publishedVersionId: true } },
      triggers: {
        where: { enabled: true, event: 'INCIDENT_CREATED' },
        include: { conditions: { orderBy: { sequence: 'asc' } } },
      },
    },
  });
  let matched = 0;
  let started = 0;
  let suggested = 0;
  let suppressed = 0;
  let skipped = 0;
  const transientFailures: unknown[] = [];
  for (const binding of bindings) {
    let matchedTrigger: { id: string; reason: string } | null = null;
    let planSnapshot: Prisma.InputJsonValue | null = null;
    const versionId =
      binding.versionStrategy === 'PINNED'
        ? binding.runbookVersionId
        : binding.runbook.publishedVersionId;
    try {
      let blocker: string | null = null;
      for (const candidate of binding.triggers) {
        const evaluation = evaluateTrigger(
          context,
          candidate.conditions,
          candidate.conditionLogic
        );
        if (evaluation.status === 'MATCHED') {
          matchedTrigger = { id: candidate.id, reason: evaluation.reason };
          break;
        }
        if (evaluation.status !== 'NOT_MATCHED') blocker ??= evaluation.reason;
      }
      if (!matchedTrigger) {
        if (blocker) {
          skipped++;
          await recordRunbookSkip({
            incidentId,
            bindingId: binding.id,
            runbookName: binding.runbook.name,
            reason: blocker,
          });
        }
        continue;
      }
      matched++;
      if (!versionId) continue;
      const version = await prisma.runbookVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { inputs: true },
      });
      const plan = resolveBindingAutomationPlan({
        definitions: version.inputs,
        binding,
        context: context.automation.fields,
      });
      let blockReason = plan.ok ? null : plan.reason;
      if (plan.ok) {
        try {
          validateBindingInputValues(
            version.inputs,
            applyRunbookInputDefaults(version.inputs, plan.inputValues)
          );
        } catch (error) {
          if (!(error instanceof RunbookDefinitionError)) throw error;
          blockReason = `INPUT_INVALID: ${error.message}`;
        }
      }
      if (!plan.ok || blockReason) {
        skipped++;
        await recordRunbookSkip({
          incidentId,
          bindingId: binding.id,
          runbookName: binding.runbook.name,
          reason: blockReason!,
        });
        continue;
      }
      planSnapshot = {
        inputValues: applyRunbookInputDefaults(version.inputs, plan.inputValues),
        agentId: plan.agentId,
        agentPoolId: plan.agentPoolId,
        agentSelector: binding.agentSelector,
        definitionChecksum: version.checksum,
        matchReason: matchedTrigger.reason,
        configRevision: binding.configRevision,
        contextChecksum: loaded.responseContext?.checksum ?? null,
        evaluationSource,
        inputProvenance: plan.inputProvenance,
        targetProvenance: plan.targetProvenance,
      } as Prisma.InputJsonValue;
      const fingerprint = computeTriggerFingerprint({
        sourceEventId,
        bindingId: binding.id,
        runbookVersionId: versionId,
      });
      if (binding.mode === 'SUGGESTED') {
        try {
          const created = await prisma.$transaction(async tx => {
            await lockRunbookForShare(tx, binding.runbookId, { action: 'suggest' });
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-trigger:${incidentId}:${binding.id}`}))`;
            if (
              await tx.runbookSuggestion.findFirst({
                where: { incidentId, bindingId: binding.id },
                select: { id: true },
              })
            )
              return false;
            await tx.runbookSuggestion.create({
              data: {
                incidentId,
                bindingId: binding.id,
                runbookVersionId: versionId,
                triggerId: matchedTrigger!.id,
                sourceEventId,
                fingerprint,
                planSnapshot: planSnapshot!,
              },
            });
            await tx.incidentEvent.create({
              data: {
                incidentId,
                type: 'RUNBOOK_SUGGESTED',
                message: `Runbook suggested: ${binding.runbook.name}`,
              },
            });
            return true;
          });
          if (created) suggested++;
        } catch (error) {
          if (error instanceof RunbookArchivedError) continue;
          if (!isAlreadyHandled(error)) throw error;
        }
        continue;
      }
      try {
        await startTriggeredRunbookExecution({
          runbookId: binding.runbookId,
          runbookVersionId: versionId,
          serviceId,
          incidentId,
          bindingId: binding.id,
          triggerId: matchedTrigger.id,
          inputValues: binding.inputValues as Record<string, unknown>,
          triggerFingerprint: fingerprint,
          sourceEventId,
          evaluationSource,
        });
        started++;
      } catch (error) {
        if (!isAlreadyHandled(error)) throw error;
      }
    } catch (error) {
      if (
        error instanceof RunbookDefinitionError &&
        error.message.includes('AUTO_REMEDIATION_BUDGET_EXHAUSTED') &&
        versionId &&
        matchedTrigger &&
        planSnapshot
      ) {
        const fingerprint = computeTriggerFingerprint({
          sourceEventId,
          bindingId: binding.id,
          runbookVersionId: versionId,
        });
        try {
          const createdSuggestion = await prisma.$transaction(async tx => {
            await lockRunbookForShare(tx, binding.runbookId, { action: 'suggest' });
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-incident-budget:${incidentId}`}))`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))`;
            if (
              await tx.runbookExecution.findFirst({
                where: {
                  OR: [
                    { triggerFingerprint: fingerprint },
                    { incidentId, bindingId: binding.id, triggerId: { not: null } },
                  ],
                },
                select: { id: true },
              })
            )
              return false;
            const existing = await tx.runbookSuggestion.findUnique({
              where: { fingerprint },
              select: { id: true },
            });
            if (existing) return false;
            await tx.runbookSuggestion.upsert({
              where: { fingerprint },
              update: {},
              create: {
                incidentId,
                bindingId: binding.id,
                runbookVersionId: versionId,
                triggerId: matchedTrigger!.id,
                sourceEventId,
                fingerprint,
                planSnapshot: planSnapshot!,
              },
            });
            await tx.incidentEvent.create({
              data: {
                incidentId,
                type: 'RUNBOOK_SUGGESTED',
                message:
                  'AUTO_REMEDIATION_BUDGET_EXHAUSTED: remaining remediation requires responder approval.',
              },
            });
            return true;
          });
          if (createdSuggestion) suggested++;
        } catch (failure) {
          if (failure instanceof RunbookArchivedError) continue;
          throw failure;
        }
        continue;
      }
      suppressed++;
      if (!(error instanceof RunbookError)) {
        transientFailures.push(error);
        continue;
      }
      await prisma.incidentEvent
        .create({
          data: {
            incidentId,
            type: 'RUNBOOK_FAILED',
            message: `Runbook trigger suppressed for binding ${binding.id}: ${error.code}`,
          },
        })
        .catch(failure => {
          transientFailures.push(failure);
        });
    }
  }
  // Retry infrastructure failures only after every unrelated binding has had a chance.
  if (transientFailures.length)
    throw new AggregateError(transientFailures, 'Some runbook triggers could not be evaluated.');
  return { matched, started, suggested, suppressed, skipped };
}
