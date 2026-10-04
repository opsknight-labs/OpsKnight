'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { RunbookError, RunbookDefinitionError } from '@/lib/runbooks/errors';
import { RUNBOOK_TEMPLATES, runbookTemplate } from '@/lib/runbooks/builder';
import { CAPABILITIES } from '@/lib/authorization';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { schedulingLabelsSchema, synchronizeLabelMemberships } from '@/lib/runbooks/pool-labels';
import {
  stageExecutionSigningKey,
  activateExecutionSigningKey,
  retireExecutionSigningKey,
  RunbookSigningRotationError,
} from '@/lib/runbooks/execution-signing';
import { assertCapability } from '@/lib/rbac';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import {
  createRunbookAgentPoolSchema,
  runbookDefinitionSchema,
  runbookInputsSchema,
} from '@/lib/runbooks/schemas';
import {
  createRunbookSecretWithGrant,
  grantRunbookSecret,
  revokeRunbookSecretGrant,
  rotateRunbookSecret,
} from '@/lib/runbooks/secrets';
import {
  archiveRunbook,
  cloneVersionToDraft,
  createRunbook,
  publishDraftVersion,
  updateDraftVersion,
  updateRunbookMetadata,
} from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();

export async function rotateRunbookSecretAction(secretId: string, formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  await rotateRunbookSecret(
    idSchema.parse(secretId),
    { value: readString(formData, 'value') },
    actor.id
  );
  revalidatePath('/runbooks/agents');
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new RunbookDefinitionError(`${label} must contain valid JSON.`);
  }
}

export async function createRunbookAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  const created = await createRunbook(
    {
      name: readString(formData, 'name'),
      slug: readString(formData, 'slug'),
      description: readString(formData, 'description'),
      definition: runbookTemplate(
        z.enum(RUNBOOK_TEMPLATES).parse(readString(formData, 'template') || 'empty')
      ),
    },
    actor.id
  );
  revalidatePath('/runbooks');
  redirect(`/runbooks/${created.id}`);
}

export async function updateRunbookMetadataAction(runbookId: string, formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  const id = idSchema.parse(runbookId);
  await updateRunbookMetadata(
    id,
    {
      name: readString(formData, 'name'),
      slug: readString(formData, 'slug'),
      description: readString(formData, 'description'),
    },
    actor.id
  );
  revalidatePath('/runbooks');
  revalidatePath(`/runbooks/${id}`);
}

export async function saveDraftAction(versionId: string, runbookId: string, formData: FormData) {
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
    const parsedVersionId = idSchema.parse(versionId);
    const parsedRunbookId = idSchema.parse(runbookId);
    const definition = runbookDefinitionSchema.parse(
      parseJson(readString(formData, 'definition'), 'Definition')
    );
    const inputs = runbookInputsSchema.parse(
      parseJson(readString(formData, 'inputs') || '[]', 'Inputs')
    );
    await updateDraftVersion(parsedVersionId, { definition, inputs }, actor.id);
    revalidatePath(`/runbooks/${parsedRunbookId}`);
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    if (error instanceof z.ZodError)
      return {
        error:
          'Check the definition and typed input fields. Keys must be unique and values must match their declared types.',
      };
    throw error;
  }
}

export async function publishDraftAction(versionId: string, runbookId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_PUBLISH);
  await publishDraftVersion(idSchema.parse(versionId), actor.id);
  revalidatePath('/runbooks');
  revalidatePath(`/runbooks/${idSchema.parse(runbookId)}`);
}

export async function cloneVersionAction(versionId: string, runbookId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  await cloneVersionToDraft(idSchema.parse(versionId), actor.id);
  revalidatePath(`/runbooks/${idSchema.parse(runbookId)}`);
}

export async function archiveRunbookAction(runbookId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  await archiveRunbook(idSchema.parse(runbookId), actor.id);
  revalidatePath('/runbooks');
  redirect('/runbooks');
}

export type AgentEnrollmentState = {
  executionPublicKey?: string;
  token?: string;
  agentId?: string;
  expiresAt?: string;
  error?: string;
};

export async function createAgentEnrollmentAction(
  _previous: AgentEnrollmentState,
  formData: FormData
): Promise<AgentEnrollmentState> {
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
    const input = z
      .object({
        name: z.string().trim().min(1).max(200),
        hostname: z.string().trim().max(255).optional(),
      })
      .parse({
        name: readString(formData, 'name'),
        hostname: readString(formData, 'hostname') || undefined,
      });
    const enrollment = await createAgentEnrollment({ ...input, actorId: actor.id });
    await logAudit({
      action: 'runbook.agent.enrollment.created',
      entityType: 'RUNBOOK_AGENT',
      entityId: enrollment.agent.id,
      actorId: actor.id,
      details: {
        name: enrollment.agent.name,
        expiresAt: enrollment.enrollmentExpiresAt.toISOString(),
      },
    });
    revalidatePath('/runbooks/agents');
    return {
      token: enrollment.token,
      executionPublicKey: enrollment.executionPublicKey,
      agentId: enrollment.agent.id,
      expiresAt: enrollment.enrollmentExpiresAt.toISOString(),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not create agent enrollment.' };
  }
}

export async function revokeAgentAction(agentId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = idSchema.parse(agentId);
  await prisma.$transaction(async tx => {
    const updated = await tx.runbookAgent.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedById: actor.id,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
      },
    });
    await synchronizeLabelMemberships(tx);
    await logAudit(
      {
        action: 'runbook.agent.revoked',
        entityType: 'RUNBOOK_AGENT',
        entityId: id,
        actorId: actor.id,
        details: { name: updated.name },
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

function parseTarget(value: string) {
  const [kind, rawId] = value.split(':', 2);
  const id = idSchema.parse(rawId);
  if (kind === 'agent') return { agentId: id };
  if (kind === 'pool') return { agentPoolId: id };
  throw new Error('Select an Agent or Agent pool.');
}

export async function createAgentPoolAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const input = createRunbookAgentPoolSchema.parse({
    name: readString(formData, 'name'),
    description: readString(formData, 'description'),
    mode: readString(formData, 'mode') || 'SHARED_TARGET',
    matchLabels: schedulingLabelsSchema.parse(
      JSON.parse(readString(formData, 'matchLabels') || '{}')
    ),
  });
  await prisma.$transaction(async tx => {
    const pool = await tx.runbookAgentPool.create({ data: { ...input, createdById: actor.id } });
    await synchronizeLabelMemberships(tx);
    await logAudit(
      {
        action: 'runbook.agent_pool.created',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: pool.id,
        actorId: actor.id,
        details: { name: pool.name, mode: pool.mode },
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

export async function updateSchedulingLabelsAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = idSchema.parse(readString(formData, 'id'));
  const kind = z.enum(['agent', 'pool']).parse(readString(formData, 'kind'));
  const labels = schedulingLabelsSchema.parse(JSON.parse(readString(formData, 'labels') || '{}'));
  await prisma.$transaction(async tx => {
    if (kind === 'agent') await tx.runbookAgent.update({ where: { id }, data: { labels } });
    else await tx.runbookAgentPool.update({ where: { id }, data: { matchLabels: labels } });
    await synchronizeLabelMemberships(tx);
    await logAudit(
      {
        action: 'runbook.scheduling_labels.updated',
        entityType: kind === 'agent' ? 'RUNBOOK_AGENT' : 'RUNBOOK_AGENT_POOL',
        entityId: id,
        actorId: actor.id,
        newValue: labels,
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

export async function rotateExecutionSigningIdentityAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const operation = z
    .enum(['stage', 'activate', 'retire'])
    .parse(readString(formData, 'operation'));
  try {
    if (operation === 'stage') await stageExecutionSigningKey(actor.id);
    else {
      const id = z.string().min(1).max(100).parse(readString(formData, 'keyId'));
      if (operation === 'activate') await activateExecutionSigningKey(id, actor.id);
      else await retireExecutionSigningKey(id, actor.id);
    }
  } catch (error) {
    if (error instanceof RunbookSigningRotationError) return { error: error.message };
    throw error;
  }
  revalidatePath('/runbooks/agents');
}

export async function updateIncidentRemediationBudgetAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  const number = z.coerce.number().int().min(0).max(100);
  const data = z
    .object({
      runbookAutoExecutionsPerIncident: number,
      runbookAutoWritesPerIncident: number,
      runbookAutoNonIdempotentPerIncident: number,
    })
    .strict()
    .parse({
      runbookAutoExecutionsPerIncident: formData.get('executions'),
      runbookAutoWritesPerIncident: formData.get('writes'),
      runbookAutoNonIdempotentPerIncident: formData.get('nonIdempotent'),
    });
  await prisma.$transaction(async tx => {
    await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    await logAudit(
      {
        action: 'runbook.incident_budget.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'default',
        actorId: actor.id,
        newValue: data,
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

export async function addAgentToPoolAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const agentId = idSchema.parse(readString(formData, 'agentId'));
  const poolId = idSchema.parse(readString(formData, 'poolId'));
  await prisma.$transaction(async tx => {
    const member = await tx.runbookAgentPoolMember.upsert({
      where: { poolId_agentId: { poolId, agentId } },
      create: { poolId, agentId },
      update: { source: 'EXPLICIT' },
    });
    await logAudit(
      {
        action: 'runbook.agent_pool.member_added',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: poolId,
        actorId: actor.id,
        details: { agentId, membershipId: member.id },
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

export async function removeAgentFromPoolAction(memberId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = idSchema.parse(memberId);
  await prisma.$transaction(async tx => {
    const existing = await tx.runbookAgentPoolMember.findUniqueOrThrow({ where: { id } });
    if (existing.source === 'DYNAMIC')
      throw new Error('Change the pool selector or Agent labels to remove dynamic membership.');
    const member = await tx.runbookAgentPoolMember.delete({ where: { id } });
    await synchronizeLabelMemberships(tx);
    await logAudit(
      {
        action: 'runbook.agent_pool.member_removed',
        entityType: 'RUNBOOK_AGENT_POOL',
        entityId: member.poolId,
        actorId: actor.id,
        details: { agentId: member.agentId, membershipId: member.id },
      },
      tx
    );
  });
  revalidatePath('/runbooks/agents');
}

export async function createRunbookSecretAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  await createRunbookSecretWithGrant(
    {
      name: readString(formData, 'name'),
      value: readString(formData, 'value'),
      description: readString(formData, 'description'),
    },
    parseTarget(readString(formData, 'target')),
    actor.id
  );
  revalidatePath('/runbooks/agents');
}

export async function grantRunbookSecretAction(secretId: string, formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  await grantRunbookSecret(
    idSchema.parse(secretId),
    parseTarget(readString(formData, 'target')),
    actor.id
  );
  revalidatePath('/runbooks/agents');
}

export async function revokeRunbookSecretGrantAction(grantId: string) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  await revokeRunbookSecretGrant(idSchema.parse(grantId), actor.id);
  revalidatePath('/runbooks/agents');
}
