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

export async function dismissIncidentRunbookSuggestionAction(
  incidentId: string,
  suggestionId: string
) {
  await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  await prisma.runbookSuggestion.updateMany({
    where: {
      id: idSchema.parse(suggestionId),
      incidentId,
      state: 'SUGGESTED',
      binding: { service: { incidents: { some: { id: incidentId } } } },
    },
    data: { state: 'DISMISSED', dismissedAt: new Date() },
  });
  revalidatePath(`/incidents/${incidentId}`);
}

async function assertExecutionBelongsToIncident(executionId: string, incidentId: string) {
  const execution = await prisma.runbookExecution.findFirst({
    where: { id: executionId, incidentId },
    select: { id: true },
  });
  if (!execution) throw new Error('Runbook execution does not belong to this incident.');
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
  await assertExecutionBelongsToIncident(idSchema.parse(executionId), incidentId);
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
  await assertExecutionBelongsToIncident(idSchema.parse(executionId), incidentId);
  await cancelExecution(idSchema.parse(executionId), actor.id, 'Cancelled by incident responder.');
  revalidatePath(`/incidents/${incidentId}`);
}

async function incidentExecutionRequest(
  incidentId: string,
  bindingId: string,
  suggestionId?: string
) {
  const [actor] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  const binding = await prisma.serviceAutomationRule.findFirst({
    where: {
      id: idSchema.parse(bindingId),
      enabled: true,
      service: { incidents: { some: { id: incidentId } } },
    },
    include: { runbook: { select: { publishedVersionId: true } } },
  });
  if (!binding) throw new Error('Runbook is unavailable for this incident.');
  return {
    runbookId: binding.runbookId,
    bindingId: binding.id,
    serviceId: binding.serviceId,
    incidentId,
    runbookVersionId:
      (binding.versionStrategy === 'PINNED'
        ? binding.runbookVersionId
        : binding.runbook.publishedVersionId) ?? undefined,
    suggestionId: suggestionId ? idSchema.parse(suggestionId) : undefined,
    triggeredByUserId: actor.id,
  };
}

export async function previewIncidentRunbookAction(
  incidentId: string,
  bindingId: string,
  suggestionId?: string
) {
  try {
    const { previewRunbookExecution } = await import('@/lib/runbooks/orchestrator');
    return {
      preview: await previewRunbookExecution(
        await incidentExecutionRequest(incidentId, bindingId, suggestionId)
      ),
    };
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}

export async function executePreviewedIncidentRunbookAction(
  incidentId: string,
  bindingId: string,
  suggestionId: string | undefined,
  data: FormData
) {
  try {
    const expectedPlanDigest = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(data.get('previewDigest'));
    await startRunbookExecution({
      ...(await incidentExecutionRequest(incidentId, bindingId, suggestionId)),
      expectedPlanDigest,
      previewAuthorizationToken: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(data.get('previewAuthorizationToken')),
    });
    revalidatePath(`/incidents/${incidentId}`);
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}
