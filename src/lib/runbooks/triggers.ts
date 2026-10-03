import 'server-only';

import prisma from '@/lib/prisma';
import { computeTriggerFingerprint } from './definition';
import { matchesTrigger } from './matcher';
import { startRunbookExecution } from './orchestrator';

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
  for (const binding of bindings) {
    const trigger = binding.triggers.find(candidate =>
      matchesTrigger(context, candidate.conditions, candidate.conditionLogic)
    );
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
      const existing = await prisma.incidentEvent.findFirst({
        where: { incidentId, type: 'RUNBOOK_SUGGESTED', message: { contains: fingerprint } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.incidentEvent.create({
          data: {
            incidentId,
            type: 'RUNBOOK_SUGGESTED',
            message: `Runbook suggested: ${binding.runbook.name} [${fingerprint}]`,
          },
        });
        suggested++;
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
        inputValues: binding.inputValues as Record<string, unknown>,
        triggerFingerprint: fingerprint,
      });
      started++;
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    }
  }
  return { matched, started, suggested };
}
