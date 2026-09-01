'use server';

import {
  ESCALATION_STEP_CHANNELS_SUBMITTED,
  escalationTargetExists,
  firstEscalationStepIssue,
  validateEscalationStep,
  type ValidatedEscalationStep,
} from '@/lib/escalation/policy-validation';
import prisma from '@/lib/prisma';
import { NotificationChannel } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { assertEscalationPolicyNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

export type PolicyFormState = {
  error?: string | null;
  success?: boolean;
  policyId?: string;
};

export async function createPolicyAction(
  _prevState: PolicyFormState,
  formData: FormData
): Promise<PolicyFormState> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const name = (formData.get('name') as string)?.trim() || '';
  const description = (formData.get('description') as string)?.trim() || null;

  if (!name || name.length < 2) {
    return { error: 'Policy name must be at least 2 characters long.' };
  }

  let normalizedName = name;
  try {
    normalizedName = await assertEscalationPolicyNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return {
        error: 'An escalation policy with this name already exists. Please choose a unique name.',
      };
    }
    return { error: error instanceof Error ? error.message : 'Failed to validate policy name.' };
  }

  try {
    const policy = await prisma.escalationPolicy.create({
      data: {
        name: normalizedName,
        description,
      },
    });

    await logAudit({
      action: 'escalation_policy.created',
      entityType: 'ESCALATION_POLICY',
      entityId: policy.id,
      actorId: currentUser.id,
      details: { name: normalizedName, stepCount: 0 },
    });

    revalidatePath('/policies');
    return { success: true, policyId: policy.id };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to create escalation policy.',
    };
  }
}

export async function createPolicy(formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;

  // Parse escalation steps from form data
  const steps: Array<ValidatedEscalationStep & { stepOrder: number }> = [];
  let stepIndex = 0;

  while (true) {
    const targetValue = formData.get(`step-${stepIndex}-target`); // Changed from userId to target
    const delay = formData.get(`step-${stepIndex}-delayMinutes`);
    const channels = formData.getAll(
      `step-${stepIndex}-notificationChannels`
    ) as NotificationChannel[];
    const notifyOnlyTeamLead = formData.get(`step-${stepIndex}-notifyOnlyTeamLead`) === 'true';

    if (!targetValue) break;

    const [type, id] = (targetValue as string).split(':');
    const targetType =
      type === 'user' ? 'USER' : type === 'team' ? 'TEAM' : type === 'schedule' ? 'SCHEDULE' : null;

    if (targetType) {
      const validation = validateEscalationStep({
        targetType,
        targetUserId: targetType === 'USER' ? id : null,
        targetTeamId: targetType === 'TEAM' ? id : null,
        targetScheduleId: targetType === 'SCHEDULE' ? id : null,
        delayMinutes: delay,
        notificationChannels: channels,
        notifyOnlyTeamLead,
      });
      if (!validation.valid) {
        return { error: `Step ${stepIndex + 1}: ${firstEscalationStepIssue(validation.issues)}` };
      }
      steps.push({ ...validation.step, stepOrder: stepIndex });
    }

    stepIndex++;
  }

  // Allow creating policy without steps initially
  // if (steps.length === 0) {
  //    throw new Error('At least one escalation step is required');
  // }

  let normalizedName = name;
  try {
    normalizedName = await assertEscalationPolicyNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect('/policies?error=duplicate-policy');
    }
    throw error;
  }

  const policy = await prisma.escalationPolicy.create({
    data: {
      name: normalizedName,
      description: description || undefined,
      steps: {
        create: steps,
      },
    },
    include: {
      steps: {
        include: { targetUser: true },
        orderBy: { stepOrder: 'asc' },
      },
    },
  });

  await logAudit({
    action: 'escalation_policy.created',
    entityType: 'ESCALATION_POLICY',
    entityId: policy.id,
    actorId: currentUser.id,
    details: { name: normalizedName, stepCount: steps.length },
  });

  revalidatePath('/policies');
  redirect(`/policies/${policy.id}`);
}

export async function updatePolicy(policyId: string, formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;

  let normalizedName = name;
  try {
    normalizedName = await assertEscalationPolicyNameAvailable(name, { excludeId: policyId });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect(`/policies/${policyId}?error=duplicate-policy`);
    }
    throw error;
  }

  await prisma.escalationPolicy.update({
    where: { id: policyId },
    data: {
      name: normalizedName,
      description: description || undefined,
    },
  });

  await logAudit({
    action: 'escalation_policy.updated',
    entityType: 'ESCALATION_POLICY',
    entityId: policyId,
    actorId: currentUser.id,
    details: { name: normalizedName },
  });

  revalidatePath('/policies');
  revalidatePath(`/policies/${policyId}`);
}

export async function deletePolicy(policyId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  // Check if policy is used by any services
  const servicesUsingPolicy = await prisma.service.findMany({
    where: { escalationPolicyId: policyId },
    select: { id: true, name: true },
  });

  if (servicesUsingPolicy.length > 0) {
    const serviceNames = servicesUsingPolicy.map(s => s.name).join(', ');
    throw new Error(
      `Cannot delete policy: ${servicesUsingPolicy.length} service(s) are using this policy (${serviceNames}). Please reassign or remove the policy from those services first.`
    );
  }

  await prisma.$transaction(async tx => {
    await tx.escalationRule.deleteMany({ where: { policyId } });
    await tx.escalationPolicy.delete({ where: { id: policyId } });
  });

  await logAudit({
    action: 'escalation_policy.deleted',
    entityType: 'ESCALATION_POLICY',
    entityId: policyId,
    actorId: currentUser.id,
  });

  revalidatePath('/policies');
  redirect('/policies');
}

export async function addPolicyStep(
  policyId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const validation = validateEscalationStep({
    targetType: formData.get('targetType') ?? 'USER',
    targetUserId: formData.get('targetUserId'),
    targetTeamId: formData.get('targetTeamId'),
    targetScheduleId: formData.get('targetScheduleId'),
    delayMinutes: formData.get('delayMinutes'),
    notificationChannels: formData.getAll('notificationChannels'),
    notifyOnlyTeamLead: formData.get('notifyOnlyTeamLead') === 'true',
  });
  if (!validation.valid) {
    return { error: firstEscalationStepIssue(validation.issues) };
  }
  const step = validation.step;
  const targetType = step.targetType;

  try {
    const nextStepOrder = await prisma.$transaction(async tx => {
      const targetId = step.targetUserId ?? step.targetTeamId ?? (step.targetScheduleId as string);
      if (!(await escalationTargetExists(tx, targetType, targetId))) {
        throw new Error(`The selected ${targetType.toLowerCase()} no longer exists.`);
      }

      const maxStep = await tx.escalationRule.findFirst({
        where: { policyId },
        orderBy: { stepOrder: 'desc' },
      });

      const order = maxStep ? maxStep.stepOrder + 1 : 0;

      await tx.escalationRule.create({
        data: { policyId, stepOrder: order, ...step },
      });

      return order;
    });

    await logAudit({
      action: 'escalation_policy.step_added',
      entityType: 'ESCALATION_POLICY',
      entityId: policyId,
      actorId: currentUser.id,
      details: { stepOrder: nextStepOrder, targetType },
    });

    revalidatePath(`/policies/${policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to add escalation step' };
  }
}

export async function updatePolicyStep(
  stepId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const existing = await prisma.escalationRule.findUnique({
    where: { id: stepId },
    include: { policy: true },
  });

  if (!existing) {
    throw new Error('Escalation step not found');
  }

  // A partial edit keeps the step's current target type and id, so the merged
  // step is validated as a whole rather than field by field.
  const targetType = formData.get('targetType') ?? existing.targetType;

  // Channels need an explicit marker rather than the usual `?? existing`
  // fallback, because an absent multi-value field and a deliberately emptied
  // one are both `[]`. Without the marker, editing only a step's delay would
  // clear its channel restriction and silently widen the step to every channel
  // the recipient has enabled.
  const channelsSubmitted = formData.get(ESCALATION_STEP_CHANNELS_SUBMITTED) === 'true';

  const validation = validateEscalationStep({
    targetType,
    targetUserId: formData.get('targetUserId') ?? existing.targetUserId,
    targetTeamId: formData.get('targetTeamId') ?? existing.targetTeamId,
    targetScheduleId: formData.get('targetScheduleId') ?? existing.targetScheduleId,
    delayMinutes: formData.get('delayMinutes'),
    notificationChannels: channelsSubmitted
      ? formData.getAll('notificationChannels')
      : existing.notificationChannels,
    notifyOnlyTeamLead: formData.get('notifyOnlyTeamLead') === 'true',
  });
  if (!validation.valid) {
    return { error: firstEscalationStepIssue(validation.issues) };
  }
  const step = validation.step;

  try {
    await prisma.$transaction(async tx => {
      const targetId = step.targetUserId ?? step.targetTeamId ?? (step.targetScheduleId as string);
      if (!(await escalationTargetExists(tx, step.targetType, targetId))) {
        throw new Error(`The selected ${step.targetType.toLowerCase()} no longer exists.`);
      }
      await tx.escalationRule.update({ where: { id: stepId }, data: step });
    });

    await logAudit({
      action: 'escalation_policy.step_updated',
      entityType: 'ESCALATION_POLICY',
      entityId: existing.policyId,
      actorId: currentUser.id,
      details: { stepId, stepOrder: existing.stepOrder, targetType: step.targetType },
    });

    revalidatePath(`/policies/${existing.policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update escalation step' };
  }
}

export async function deletePolicyStep(stepId: string): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const step = await prisma.escalationRule.findUnique({
    where: { id: stepId },
    include: { policy: true },
  });

  if (!step) {
    return { error: 'Escalation step not found' };
  }

  const policyId = step.policyId;
  const deletedStepOrder = step.stepOrder;

  try {
    await prisma.$transaction(async tx => {
      await tx.escalationRule.delete({
        where: { id: stepId },
      });

      // Reorder remaining steps
      const remainingSteps = await tx.escalationRule.findMany({
        where: { policyId },
        orderBy: { stepOrder: 'asc' },
      });

      // Update step orders to be sequential
      for (let i = 0; i < remainingSteps.length; i++) {
        if (remainingSteps[i].stepOrder !== i) {
          await tx.escalationRule.update({
            where: { id: remainingSteps[i].id },
            data: { stepOrder: i },
          });
        }
      }
    });

    await logAudit({
      action: 'escalation_policy.step_deleted',
      entityType: 'ESCALATION_POLICY',
      entityId: policyId,
      actorId: currentUser.id,
      details: { deletedStepOrder },
    });

    revalidatePath(`/policies/${policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to delete escalation step' };
  }
}

export async function movePolicyStep(
  stepId: string,
  direction: 'up' | 'down'
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const step = await prisma.escalationRule.findUnique({
    where: { id: stepId },
    include: { policy: true },
  });

  if (!step) {
    return { error: 'Escalation step not found' };
  }

  const policyId = step.policyId;
  const currentOrder = step.stepOrder;
  const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;

  if (newOrder < 0) {
    return { error: 'Cannot move step up: already at first position' };
  }

  // Get all steps
  const allSteps = await prisma.escalationRule.findMany({
    where: { policyId },
    orderBy: { stepOrder: 'asc' },
  });

  if (newOrder >= allSteps.length) {
    return { error: 'Cannot move step down: already at last position' };
  }

  // Find the step at the target position
  const targetStep = allSteps.find(s => s.stepOrder === newOrder);
  if (!targetStep) {
    return { error: 'Target step not found' };
  }

  // Swap targets while preserving timeline positional delays (e.g. Step 1 stays Immediate 0m)
  const currentDelay = step.delayMinutes;
  const targetDelay = targetStep.delayMinutes;

  try {
    // Swap step orders and positional delays via temporary negative index to satisfy @@unique([policyId, stepOrder])
    await prisma.$transaction(async tx => {
      await tx.escalationRule.update({
        where: { id: stepId },
        data: { stepOrder: -1 },
      });

      await tx.escalationRule.update({
        where: { id: targetStep.id },
        data: { stepOrder: currentOrder, delayMinutes: currentDelay },
      });

      await tx.escalationRule.update({
        where: { id: stepId },
        data: { stepOrder: newOrder, delayMinutes: targetDelay },
      });
    });

    await logAudit({
      action: 'escalation_policy.step_moved',
      entityType: 'ESCALATION_POLICY',
      entityId: policyId,
      actorId: currentUser.id,
      details: { stepId, from: currentOrder, to: newOrder },
    });

    revalidatePath(`/policies/${policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to move escalation step' };
  }
}

export type StepReorderItem = string | { id: string; delayMinutes?: number };

export async function reorderPolicySteps(
  policyId: string,
  newOrder: StepReorderItem[]
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const orderIds = newOrder.map(item => (typeof item === 'string' ? item : item.id));
  const delayMap = new Map<string, number>();
  newOrder.forEach(item => {
    if (typeof item === 'object' && typeof item.delayMinutes === 'number') {
      delayMap.set(item.id, item.delayMinutes);
    }
  });

  try {
    await prisma.$transaction(async tx => {
      // Verify all steps belong to the policy
      const steps = await tx.escalationRule.findMany({
        where: {
          policyId,
          id: { in: orderIds },
        },
        select: { id: true, stepOrder: true },
      });

      if (steps.length !== orderIds.length) {
        throw new Error('Invalid step IDs provided for reordering');
      }

      // Step 1: Temporarily set all steps to negative indices to prevent @@unique([policyId, stepOrder]) collisions
      for (const [i, stepId] of orderIds.entries()) {
        await tx.escalationRule.update({
          where: { id: stepId },
          data: {
            stepOrder: -(i + 1),
          },
        });
      }

      // Step 2: Assign final sequential 0-indexed positions & update positional delays if provided
      for (const [i, stepId] of orderIds.entries()) {
        const delay = delayMap.get(stepId);
        await tx.escalationRule.update({
          where: { id: stepId },
          data: {
            stepOrder: i,
            ...(typeof delay === 'number' ? { delayMinutes: delay } : {}),
          },
        });
      }
    });

    await logAudit({
      action: 'escalation_policy.steps_reordered',
      entityType: 'ESCALATION_POLICY',
      entityId: policyId,
      actorId: currentUser.id,
      details: { newOrderCount: orderIds.length },
    });

    revalidatePath(`/policies/${policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to reorder escalation steps' };
  }
}
