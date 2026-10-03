'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, assertCapability } from '@/lib/rbac';
import {
  approveExecutionStep,
  cancelExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';

const idSchema = z.string().cuid();

export async function startIncidentRunbookAction(incidentId: string, bindingId: string) {
  const [actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  const binding = await prisma.serviceRunbookBinding.findFirst({
    where: {
      id: idSchema.parse(bindingId),
      enabled: true,
      service: { incidents: { some: { id: incidentId } } },
    },
    include: { runbook: { select: { publishedVersionId: true } } },
  });
  if (!binding) throw new Error('Runbook is not available for this incident service.');
  const versionId =
    binding.versionStrategy === 'PINNED'
      ? binding.runbookVersionId
      : binding.runbook.publishedVersionId;
  if (!versionId) throw new Error('Runbook has no executable published version.');
  await startRunbookExecution({
    runbookId: binding.runbookId,
    runbookVersionId: versionId,
    incidentId,
    serviceId: binding.serviceId,
    bindingId: binding.id,
    inputValues: binding.inputValues as Record<string, unknown>,
    triggeredByUserId: actor.id,
  });
  revalidatePath(`/incidents/${incidentId}`);
}

export async function approveIncidentRunbookStepAction(
  incidentId: string,
  executionId: string,
  stepId: string,
  planDigest: string
) {
  const [actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_APPROVE),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  await approveExecutionStep({
    executionId: idSchema.parse(executionId),
    stepId: idSchema.parse(stepId),
    planDigest: z.string().length(64).parse(planDigest),
    actorId: actor.id,
  });
  revalidatePath(`/incidents/${incidentId}`);
}

export async function cancelIncidentRunbookAction(incidentId: string, executionId: string) {
  const [actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  await cancelExecution(idSchema.parse(executionId), actor.id, 'Cancelled by incident responder.');
  revalidatePath(`/incidents/${incidentId}`);
}
