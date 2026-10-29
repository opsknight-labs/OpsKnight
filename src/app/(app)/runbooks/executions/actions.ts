'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { AppError, toPublicAppError } from '@/lib/errors';
import { assertCanViewIncident, assertCanViewService, assertCapability } from '@/lib/rbac';
import {
  approveExecutionStep,
  cancelExecution,
  previewRunbookExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { buildRerunRequest, getRerunBlockedReason, loadRerunSource } from '@/lib/runbooks/rerun';

const idSchema = z.string().cuid();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

async function assertExecutionScope(scope: {
  incidentId: string | null;
  serviceId: string | null;
}) {
  if (scope.incidentId) await assertCanViewIncident(scope.incidentId);
  else if (scope.serviceId) await assertCanViewService(scope.serviceId);
}

function executionNotFound() {
  return new AppError({ code: 'RUNBOOK_EXECUTION_NOT_FOUND' });
}

async function rerunRequest(executionId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_EXECUTE);
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const source = await loadRerunSource(idSchema.parse(executionId));
  if (!source) throw executionNotFound();
  await assertExecutionScope(source);
  const blocked = getRerunBlockedReason(source);
  if (blocked)
    throw new AppError({ code: 'RUNBOOK_EXECUTION_INVALID_TRANSITION', userMessage: blocked });
  return buildRerunRequest(source, actor.id);
}

function revalidateExecutionPaths(executionId: string, incidentId?: string | null) {
  revalidatePath('/runbooks/executions');
  revalidatePath(`/runbooks/executions/${executionId}`);
  if (incidentId) revalidatePath(`/incidents/${incidentId}`);
}

export async function previewRerunAction(executionId: string) {
  try {
    return { preview: await previewRunbookExecution(await rerunRequest(executionId)) };
  } catch (error) {
    return { error: toPublicAppError(error).message };
  }
}

export async function executeRerunAction(executionId: string, data: FormData) {
  let newExecutionId: string;
  try {
    const request = await rerunRequest(executionId);
    const execution = await startRunbookExecution({
      ...request,
      expectedPlanDigest: digestSchema.parse(data.get('previewDigest')),
      previewAuthorizationToken: digestSchema.parse(data.get('previewAuthorizationToken')),
    });
    newExecutionId = execution.id;
    revalidateExecutionPaths(executionId, request.incidentId);
  } catch (error) {
    return { error: toPublicAppError(error).message };
  }
  redirect(`/runbooks/executions/${newExecutionId}`);
}

export async function cancelExecutionAction(executionId: string) {
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_EXECUTE);
    const execution = await prisma.runbookExecution.findUnique({
      where: { id: idSchema.parse(executionId) },
      select: { id: true, incidentId: true, serviceId: true },
    });
    if (!execution) throw executionNotFound();
    await assertExecutionScope(execution);
    await cancelExecution(execution.id, actor.id, 'Cancelled from execution detail.');
    revalidateExecutionPaths(execution.id, execution.incidentId);
  } catch (error) {
    return { error: toPublicAppError(error).message };
  }
}

export async function approveExecutionStepAction(
  executionId: string,
  stepId: string,
  planDigest: string
) {
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_APPROVE);
    const execution = await prisma.runbookExecution.findUnique({
      where: { id: idSchema.parse(executionId) },
      select: { id: true, incidentId: true, serviceId: true },
    });
    if (!execution) throw executionNotFound();
    await assertExecutionScope(execution);
    await approveExecutionStep({
      executionId: execution.id,
      stepId: idSchema.parse(stepId),
      planDigest: z.string().length(64).parse(planDigest),
      actorId: actor.id,
    });
    revalidateExecutionPaths(execution.id, execution.incidentId);
  } catch (error) {
    return { error: toPublicAppError(error).message };
  }
}
