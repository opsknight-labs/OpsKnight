import 'server-only';

import prisma from '@/lib/prisma';
import { computeTriggerFingerprint } from './definition';
import { matchesTrigger } from './matcher';
import { startRunbookExecution } from './orchestrator';
import { RunbookDefinitionError, RunbookError } from './errors';
import { conditionContextFieldSchema, conditionOperatorSchema } from './conditions';
import { applyRunbookInputDefaults, validateBindingInputValues } from './bindings';
import type { Prisma } from '@prisma/client';

export async function evaluateIncidentTriggers(incidentId: string, sourceEventId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      urgency: true,
      priority: true,
      serviceId: true,
      service: { select: { name: true, teamId: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!incident) return { matched: 0, started: 0, suggested: 0 };
  const bindings = await prisma.serviceRunbookBinding.findMany({
    where: {
      serviceId: incident.serviceId,
      enabled: true,
      mode: { in: ['SUGGESTED', 'AUTOMATIC'] },
      runbook: { archivedAt: null },
      triggers: { some: { enabled: true, event: 'INCIDENT_CREATED' } },
    },
    include: {
      runbook: { select: { name: true, publishedVersionId: true } },
      triggers: {
        where: { enabled: true, event: 'INCIDENT_CREATED' },
        include: { conditions: { orderBy: { sequence: 'asc' } } },
      },
    },
  });
  const context = {
    incident: {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      urgency: incident.urgency,
      priority: incident.priority,
      tags: incident.tags.map(item => item.tag.name),
    },
    service: {
      id: incident.serviceId,
      name: incident.service.name,
      teamId: incident.service.teamId,
    },
  };
  let matched = 0;
  let started = 0;
  let suggested = 0;
  let suppressed = 0;
  const transientFailures: unknown[] = [];
  for (const binding of bindings) {
    try {
      const trigger = binding.triggers.find(candidate => {
        // Stored legacy/out-of-band conditions must fail closed too, before OR evaluation.
        if (
          candidate.conditions.some(
            condition =>
              !conditionContextFieldSchema.safeParse(condition.field).success ||
              !conditionOperatorSchema.safeParse(condition.operator).success
          )
        )
          throw new RunbookDefinitionError(
            'Trigger has an unsupported condition field or operator.'
          );
        return matchesTrigger(context, candidate.conditions, candidate.conditionLogic);
      });
      if (!trigger) continue;
      matched++;
      const versionId =
        binding.versionStrategy === 'PINNED'
          ? binding.runbookVersionId
          : binding.runbook.publishedVersionId;
      if (!versionId) continue;
      const fingerprint = computeTriggerFingerprint({
        sourceEventId,
        bindingId: binding.id,
        runbookVersionId: versionId,
      });
      if (binding.mode === 'SUGGESTED') {
        try {
          await prisma.$transaction(async tx => {
            const version = await tx.runbookVersion.findUniqueOrThrow({
              where: { id: versionId },
              include: { inputs: true },
            });
            const inputValues = applyRunbookInputDefaults(
              version.inputs,
              binding.inputValues as Record<string, unknown>
            );
            validateBindingInputValues(version.inputs, inputValues);
            await tx.runbookSuggestion.create({
              data: {
                incidentId,
                bindingId: binding.id,
                runbookVersionId: versionId,
                triggerId: trigger.id,
                sourceEventId,
                fingerprint,
                planSnapshot: {
                  inputValues,
                  agentId: binding.defaultAgentId,
                  agentPoolId: binding.defaultAgentPoolId,
                  agentSelector: binding.agentSelector,
                  definitionChecksum: version.checksum,
                } as Prisma.InputJsonValue,
              },
            });
            await tx.incidentEvent.create({
              data: {
                incidentId,
                type: 'RUNBOOK_SUGGESTED',
                message: `Runbook suggested: ${binding.runbook.name}`,
              },
            });
          });
          suggested++;
        } catch (error) {
          if ((error as { code?: string })?.code !== 'P2002') throw error;
        }
        continue;
      }
      try {
        await startRunbookExecution({
          runbookId: binding.runbookId,
          runbookVersionId: versionId,
          serviceId: incident.serviceId,
          incidentId,
          bindingId: binding.id,
          triggerId: trigger.id,
          inputValues: binding.inputValues as Record<string, unknown>,
          triggerFingerprint: fingerprint,
        });
        started++;
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
      }
    } catch (error) {
      if (
        error instanceof RunbookDefinitionError &&
        error.message.includes('AUTO_REMEDIATION_BUDGET_EXHAUSTED')
      ) {
        const versionId =
          binding.versionStrategy === 'PINNED'
            ? binding.runbookVersionId
            : binding.runbook.publishedVersionId;
        if (versionId) {
          const version = await prisma.runbookVersion.findUniqueOrThrow({
            where: { id: versionId },
            include: { inputs: true },
          });
          const trigger = binding.triggers.find(candidate =>
            matchesTrigger(context, candidate.conditions, candidate.conditionLogic)
          )!;
          const fingerprint = computeTriggerFingerprint({
            sourceEventId,
            bindingId: binding.id,
            runbookVersionId: versionId,
          });
          const inputValues = applyRunbookInputDefaults(
            version.inputs,
            binding.inputValues as Record<string, unknown>
          );
          const createdSuggestion = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runbook-incident-budget:${incidentId}`}))`;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))`;
            if (
              await tx.runbookExecution.findUnique({
                where: { triggerFingerprint: fingerprint },
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
                sourceEventId,
                fingerprint,
                planSnapshot: {
                  inputValues,
                  agentId: binding.defaultAgentId,
                  agentPoolId: binding.defaultAgentPoolId,
                  agentSelector: binding.agentSelector,
                  definitionChecksum: version.checksum,
                } as Prisma.InputJsonValue,
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
          continue;
        }
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
  return { matched, started, suggested, suppressed };
}
