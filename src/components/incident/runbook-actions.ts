'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import type { RunbookInput } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, assertCapability, getUserPermissions } from '@/lib/rbac';
import {
  approveExecutionStep,
  cancelExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { flattenSteps, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { RunbookDefinitionError } from '@/lib/runbooks/errors';
import { requiresAgent } from '@/lib/runbooks/types';

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

async function adhocIncidentContext(incidentId: string) {
  const [actor, permissions] = await Promise.all([
    assertCapability(CAPABILITIES.RUNBOOK_EXECUTE),
    getUserPermissions(),
    assertCanViewIncident(idSchema.parse(incidentId)),
  ]);
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, serviceId: true },
  });
  if (!incident) throw new RunbookDefinitionError('Incident was not found.');
  return { actor, permissions, incident };
}

async function publishedAdhocRunbook(runbookId: string) {
  const runbook = await prisma.runbook.findFirst({
    where: {
      id: idSchema.parse(runbookId),
      archivedAt: null,
      publishedVersion: { is: { state: 'PUBLISHED' } },
    },
    select: {
      id: true,
      name: true,
      description: true,
      publishedVersion: {
        select: {
          id: true,
          version: true,
          definition: true,
          inputs: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
  if (!runbook?.publishedVersion)
    throw new RunbookDefinitionError('Runbook is not published or was archived.');
  return { ...runbook, publishedVersion: runbook.publishedVersion };
}

function adhocInputValues(
  formData: FormData,
  definitions: Pick<RunbookInput, 'key' | 'type'>[]
): Record<string, unknown> {
  const known = new Set(definitions.map(input => `input:${input.key}`));
  for (const name of formData.keys())
    if (name.startsWith('input:') && !known.has(name))
      throw new RunbookDefinitionError(
        'Runbook inputs changed. Reload and review the published version.'
      );
  const values: Record<string, unknown> = {};
  for (const input of definitions) {
    const raw = formData.get(`input:${input.key}`);
    if (input.type === 'BOOLEAN') {
      values[input.key] = raw === 'true';
      continue;
    }
    if (typeof raw !== 'string' || raw === '') continue;
    if (input.type === 'NUMBER') {
      const number = Number(raw);
      if (!Number.isFinite(number))
        throw new RunbookDefinitionError(`${input.key} must be a valid number.`);
      values[input.key] = number;
    } else if (input.type === 'SECRET_REF') {
      values[input.key] = raw.startsWith('secret://') ? raw : `secret://${raw}`;
    } else {
      values[input.key] = raw;
    }
  }
  return values;
}

function adhocTarget(value: FormDataEntryValue | null) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || raw === 'none') return {};
  const [kind, id] = raw.split(':', 2);
  if (kind === 'agent') return { targetAgentId: idSchema.parse(id) };
  if (kind === 'pool') return { targetAgentPoolId: idSchema.parse(id) };
  throw new RunbookDefinitionError('Invalid Runbook execution target.');
}

async function assertAdhocRunbookAccess(
  permissions: { capabilities: readonly string[] },
  incident: { serviceId: string | null },
  runbookId: string
) {
  const canReadAll = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL);
  if (canReadAll) return;

  const canReadScoped = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED);
  if (!canReadScoped || !incident.serviceId) {
    throw new RunbookDefinitionError('Runbook access denied for this incident.');
  }

  const bound = await prisma.serviceAutomationRule.findFirst({
    where: {
      runbookId: idSchema.parse(runbookId),
      serviceId: incident.serviceId,
      enabled: true,
      detachedAt: null,
    },
    select: { id: true },
  });
  if (!bound) {
    throw new RunbookDefinitionError(
      'Runbook access denied: runbook is not attached to this incident’s service.'
    );
  }
}

async function adhocExecutionRequest(incidentId: string, runbookId: string, formData: FormData) {
  const { actor, permissions, incident } = await adhocIncidentContext(incidentId);
  await assertAdhocRunbookAccess(permissions, incident, runbookId);
  const runbook = await publishedAdhocRunbook(runbookId);
  return {
    runbookId: runbook.id,
    serviceId: incident.serviceId,
    incidentId: incident.id,
    inputValues: adhocInputValues(formData, runbook.publishedVersion.inputs),
    ...adhocTarget(formData.get('executionTarget')),
    triggeredByUserId: actor.id,
  };
}

export async function searchAdhocIncidentRunbooksAction(incidentId: string, query: string) {
  const { permissions, incident } = await adhocIncidentContext(incidentId);
  const canReadAll = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL);
  const canReadScoped = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED);
  if (!canReadAll && !canReadScoped) {
    return [];
  }
  if (!canReadAll && !incident.serviceId) {
    return [];
  }
  const q = z.string().trim().max(100).catch('').parse(query);
  const runbooks = await prisma.runbook.findMany({
    where: {
      archivedAt: null,
      publishedVersion: { is: { state: 'PUBLISHED' } },
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(!canReadAll && incident.serviceId
        ? {
            serviceAutomationRules: {
              some: {
                serviceId: incident.serviceId,
                enabled: true,
                detachedAt: null,
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      publishedVersion: { select: { version: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return runbooks.map(runbook => ({
    id: runbook.id,
    name: runbook.name,
    description: runbook.description,
    version: runbook.publishedVersion?.version ?? null,
  }));
}

export async function loadAdhocIncidentRunbookAction(incidentId: string, runbookId: string) {
  try {
    const { permissions, incident } = await adhocIncidentContext(incidentId);
    await assertAdhocRunbookAccess(permissions, incident, runbookId);
    const runbook = await publishedAdhocRunbook(runbookId);
    const steps = flattenSteps(parseRunbookDefinition(runbook.publishedVersion.definition));
    const [agents, pools] = await Promise.all([
      prisma.runbookAgent.findMany({
        where: { status: { in: ['ONLINE', 'DEGRADED', 'OFFLINE'] } },
        take: 100,
        select: { id: true, name: true, hostname: true },
        orderBy: { name: 'asc' },
      }),
      prisma.runbookAgentPool.findMany({
        take: 100,
        select: { id: true, name: true, mode: true, _count: { select: { members: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      runbook: {
        id: runbook.id,
        name: runbook.name,
        description: runbook.description,
        version: runbook.publishedVersion.version,
        inputs: runbook.publishedVersion.inputs.map(input => ({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          defaultValue: input.defaultValue,
          description: input.description,
          options: input.options,
        })),
        requiresAgent: steps.some(step => requiresAgent(step.type)),
        hasAgentWrite: steps.some(
          step => requiresAgent(step.type) && step.riskClass !== 'READ_ONLY'
        ),
        hasWrite: steps.some(step => step.riskClass !== 'READ_ONLY'),
      },
      targets: { agents, pools },
    };
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}

export async function previewAdhocIncidentRunbookAction(
  incidentId: string,
  runbookId: string,
  formData: FormData
) {
  try {
    const { previewRunbookExecution } = await import('@/lib/runbooks/orchestrator');
    return {
      preview: await previewRunbookExecution(
        await adhocExecutionRequest(incidentId, runbookId, formData)
      ),
    };
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}

export async function executeAdhocIncidentRunbookAction(
  incidentId: string,
  runbookId: string,
  formData: FormData
) {
  try {
    const digest = z.string().regex(/^[a-f0-9]{64}$/);
    const expectedPlanDigest = digest.parse(formData.get('previewDigest'));
    const previewAuthorizationToken = digest.parse(formData.get('previewAuthorizationToken'));
    await startRunbookExecution({
      ...(await adhocExecutionRequest(incidentId, runbookId, formData)),
      expectedPlanDigest,
      previewAuthorizationToken,
    });
    revalidatePath(`/incidents/${incidentId}`);
  } catch (error) {
    const { toPublicAppError } = await import('@/lib/errors');
    return { error: toPublicAppError(error).message };
  }
}
