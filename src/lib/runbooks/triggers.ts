import 'server-only';

import prisma from '@/lib/prisma';
import { computeTriggerFingerprint } from './definition';
import { evaluateTrigger } from './matcher';
import { loadRunbookIncidentContext } from './incident-context';
import {
  INCIDENT_NOT_OPEN,
  lockOpenIncidentForAutomation,
  startTriggeredRunbookExecution,
} from './orchestrator';
import { RunbookArchivedError, RunbookDefinitionError, RunbookError } from './errors';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import { resolveBindingAutomationPlan } from './automation-binding';
import { lockRunbookForShare } from './locking';
import type { Prisma } from '@prisma/client';

export type TriggerEvaluationSource = 'MONITORING' | 'MANUAL';

/**
 * Fails closed: an alert-linked incident is always MONITORING, and only an exact 'MANUAL'
 * (or a legacy job without a source) on an incident without alerts is MANUAL.
 */
export function classifyEvaluationSource(
  raw: unknown,
  alertLinked: boolean
): TriggerEvaluationSource {
  if (alertLinked) return 'MONITORING';
  return raw === undefined || raw === 'MANUAL' ? 'MANUAL' : 'MONITORING';
}

async function resolveEvaluationSource(
  incidentId: string,
  raw: unknown
): Promise<TriggerEvaluationSource> {
  const alerts = await prisma.alert.count({ where: { incidentId } });
  return classifyEvaluationSource(raw, alerts > 0);
}

/** Actionable audit: at most one skip event per rule, reason and incident, across retries. */
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

const isIncidentNotOpen = (error: unknown) =>
  error instanceof RunbookDefinitionError && error.message.startsWith(INCIDENT_NOT_OPEN);

const isAlreadyHandled = (error: unknown) =>
  (error as { code?: string })?.code === 'P2002' ||
  (error instanceof RunbookDefinitionError && error.message.includes('TRIGGER_ALREADY_HANDLED'));

async function* incidentRuleBatches(serviceId: string, source: TriggerEvaluationSource) {
  let after: string | undefined;
  while (true) {
    const bindings = await prisma.serviceAutomationRule.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        serviceId: serviceId,
        enabled: true,
        detachedAt: null,
        mode: { in: ['SUGGESTED', 'AUTOMATIC'] },
        runbook: { archivedAt: null },
        triggers: { some: { enabled: true, event: 'INCIDENT_CREATED' } },
        // Monitoring-sourced incidents only consider rules that explicitly opt in.
        ...(source === 'MONITORING' ? { runOnMonitoringIncidents: true } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
      include: {
        runbook: { select: { name: true, publishedVersionId: true } },
        triggers: {
          where: { enabled: true, event: 'INCIDENT_CREATED' },
          include: { conditions: { orderBy: { sequence: 'asc' } } },
        },
      },
    });
    if (!bindings.length) return;
    yield bindings;
    after = bindings[bindings.length - 1].id;
    if (bindings.length < 100) return;
  }
}

type CurrentRuleFence = {
  id: string;
  runbookId: string;
  configurationRevision: number;
  mode: Prisma.ServiceAutomationRuleGetPayload<object>['mode'];
  versionStrategy: Prisma.ServiceAutomationRuleGetPayload<object>['versionStrategy'];
  runbook: { publishedVersionId: string | null };
};

/** A paused, detached, edited or re-pinned rule may have been read before its change committed. */
async function ruleStillCurrent(
  tx: Prisma.TransactionClient,
  binding: CurrentRuleFence,
  trigger: { id: string; revision: number }
) {
  await tx.$queryRaw`SELECT id FROM "ServiceRunbookBinding" WHERE id = ${binding.id} AND "runbookId" = ${binding.runbookId} FOR SHARE`;
  const rule = await tx.serviceAutomationRule.findFirst({
    where: {
      id: binding.id,
      enabled: true,
      detachedAt: null,
      configurationRevision: binding.configurationRevision,
      mode: binding.mode,
      ...(binding.versionStrategy === 'LATEST_PUBLISHED'
        ? { runbook: { publishedVersionId: binding.runbook.publishedVersionId } }
        : {}),
    },
    select: { id: true },
  });
  if (!rule) return false;
  const current = await tx.runbookTrigger.findFirst({
    where: {
      id: trigger.id,
      bindingId: binding.id,
      revision: trigger.revision,
      enabled: true,
      event: 'INCIDENT_CREATED',
    },
    select: { id: true },
  });
  return !!current;
}

export async function evaluateIncidentTriggers(
  incidentId: string,
  sourceEventId: string,
  options: { source?: unknown } = {}
) {
  const loaded = await loadRunbookIncidentContext(prisma, incidentId);
  if (!loaded) return { matched: 0, started: 0, suggested: 0 };
  const context = loaded.trigger;
  const serviceId = context.service.id;
  const evaluationSource = await resolveEvaluationSource(incidentId, options.source);
  let matched = 0;
  let started = 0;
  let suggested = 0;
  let suppressed = 0;
  let skipped = 0;
  // The job runs after commit; an incident closed in between must not start remediation.
  if (context.incident.status !== 'OPEN') {
    for await (const bindings of incidentRuleBatches(serviceId, evaluationSource)) {
      for (const binding of bindings) {
        skipped++;
        await recordRunbookSkip({
          incidentId,
          bindingId: binding.id,
          runbookName: binding.runbook.name,
          reason: `${INCIDENT_NOT_OPEN}: incident is ${context.incident.status}`,
        });
      }
    }
    return { matched, started, suggested, suppressed, skipped };
  }
  const transientFailures: unknown[] = [];
  for await (const bindings of incidentRuleBatches(serviceId, evaluationSource)) {
    for (const binding of bindings) {
      let matchedTrigger: { id: string; revision: number; reason: string } | null = null;
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
            matchedTrigger = {
              id: candidate.id,
              revision: candidate.revision,
              reason: evaluation.reason,
            };
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
        const trigger = matchedTrigger;
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
          matchReason: trigger.reason,
          configRevision: binding.configurationRevision,
          contextChecksum: loaded.responseContext?.checksum ?? null,
          evaluationSource,
          inputProvenance: plan.inputProvenance,
          targetProvenance: plan.targetProvenance,
        } as Prisma.InputJsonValue;
        const snapshot = planSnapshot;
        const fingerprint = computeTriggerFingerprint({
          sourceEventId,
          bindingId: binding.id,
          runbookVersionId: versionId,
        });
        if (binding.mode === 'SUGGESTED') {
          try {
            const created = await prisma.$transaction(async tx => {
              const incidentLock = await lockOpenIncidentForAutomation(tx, incidentId);
              if (!incidentLock.open) return incidentLock.reason;
              await lockRunbookForShare(tx, binding.runbookId, { action: 'suggest' });
              if (!(await ruleStillCurrent(tx, binding, trigger))) return false;
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
                  triggerId: trigger.id,
                  triggerRevision: trigger.revision,
                  sourceEventId,
                  fingerprint,
                  planSnapshot: snapshot,
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
            if (typeof created === 'string') {
              skipped++;
              await recordRunbookSkip({
                incidentId,
                bindingId: binding.id,
                runbookName: binding.runbook.name,
                reason: created,
              });
            } else if (created) suggested++;
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
            triggerId: trigger.id,
            expectedRuleRevision: binding.configurationRevision,
            inputValues: binding.inputValues as Record<string, unknown>,
            triggerFingerprint: fingerprint,
            sourceEventId,
            evaluationSource,
          });
          started++;
        } catch (error) {
          if (isIncidentNotOpen(error)) {
            skipped++;
            await recordRunbookSkip({
              incidentId,
              bindingId: binding.id,
              runbookName: binding.runbook.name,
              reason: (error as Error).message,
            });
            continue;
          }
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
          const trigger = matchedTrigger;
          const snapshot = planSnapshot;
          const fingerprint = computeTriggerFingerprint({
            sourceEventId,
            bindingId: binding.id,
            runbookVersionId: versionId,
          });
          try {
            const createdSuggestion = await prisma.$transaction(async tx => {
              const incidentLock = await lockOpenIncidentForAutomation(tx, incidentId);
              if (!incidentLock.open) return incidentLock.reason;
              await lockRunbookForShare(tx, binding.runbookId, { action: 'suggest' });
              if (!(await ruleStillCurrent(tx, binding, trigger))) return false;
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
                  triggerId: trigger.id,
                  triggerRevision: trigger.revision,
                  sourceEventId,
                  fingerprint,
                  planSnapshot: snapshot,
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
            if (typeof createdSuggestion === 'string') {
              skipped++;
              await recordRunbookSkip({
                incidentId,
                bindingId: binding.id,
                runbookName: binding.runbook.name,
                reason: createdSuggestion,
              });
            } else if (createdSuggestion) suggested++;
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
  }
  // Retry infrastructure failures only after every unrelated rule has had a chance.
  if (transientFailures.length)
    throw new AggregateError(transientFailures, 'Some runbook triggers could not be evaluated.');
  return { matched, started, suggested, suppressed, skipped };
}
