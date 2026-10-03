'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { assertCapability } from '@/lib/rbac';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import { runbookDefinitionSchema, runbookInputsSchema } from '@/lib/runbooks/schemas';
import {
  archiveRunbook,
  cloneVersionToDraft,
  createRunbook,
  publishDraftVersion,
  updateDraftVersion,
  updateRunbookMetadata,
} from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

export async function createRunbookAction(formData: FormData) {
  const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
  const created = await createRunbook(
    {
      name: readString(formData, 'name'),
      slug: readString(formData, 'slug'),
      description: readString(formData, 'description'),
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
