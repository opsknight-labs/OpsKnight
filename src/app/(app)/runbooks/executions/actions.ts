'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { toPublicAppError } from '@/lib/errors';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { requireExecutionControl, requireRerunRequest } from '@/lib/api-v2/runbook-intervention';
import {
  approveExecutionStep,
  cancelExecution,
  previewRunbookExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';

const idSchema = z.string().cuid();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

// The same rule as API v2 (requireExecutionControl): readable, and the triggerer, an admin or a
// member of the service's team may intervene.
async function rerunRequest(executionId: string) {
  await assertCapability(CAPABILITIES.RUNBOOK_EXECUTE);
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  return requireRerunRequest(
    prisma,
    await getCurrentAuthorizationActor(),
    idSchema.parse(executionId)
  );
}

async function controlledExecution(executionId: string) {
  return requireExecutionControl(
    prisma,
    await getCurrentAuthorizationActor(),
    idSchema.parse(executionId)
  );
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
    const execution = await controlledExecution(executionId);
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
    const execution = await controlledExecution(executionId);
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
