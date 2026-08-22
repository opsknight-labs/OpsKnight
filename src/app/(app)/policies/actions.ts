'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import { getDefaultActorId, logAudit } from '@/lib/audit';
import { assertEscalationPolicyNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

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
  const steps: Array<{
    targetType: 'USER' | 'TEAM' | 'SCHEDULE';
    targetUserId?: string;
    targetTeamId?: string;
    delayMinutes: number;
    stepOrder: number;
  }> = [];
  let stepIndex = 0;

  while (true) {
    const targetValue = formData.get(`step-${stepIndex}-target`); // Changed from userId to target
    const delay = formData.get(`step-${stepIndex}-delayMinutes`);

    if (!targetValue) break;

    const [type, id] = (targetValue as string).split(':');

    if (type === 'user') {
      steps.push({
        targetType: 'USER',
        targetUserId: id,
        delayMinutes: parseInt((delay as string) || '0'),
        stepOrder: stepIndex,
      });
    } else if (type === 'team') {
      steps.push({
        targetType: 'TEAM',
        targetTeamId: id,
        delayMinutes: parseInt((delay as string) || '0'),
        stepOrder: stepIndex,
      });
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

  await prisma.escalationPolicy.delete({
    where: { id: policyId },
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

  const targetType = (formData.get('targetType') as 'USER' | 'TEAM' | 'SCHEDULE') || 'USER';
  const targetUserId = formData.get('targetUserId') as string | null;
  const targetTeamId = formData.get('targetTeamId') as string | null;
  const targetScheduleId = formData.get('targetScheduleId') as string | null;
  const delayMinutes = parseInt((formData.get('delayMinutes') as string) || '0');
  const notificationChannels = formData.getAll('notificationChannels') as string[];
  const notifyOnlyTeamLead = formData.get('notifyOnlyTeamLead') === 'true';

  // Validate that appropriate target ID is provided
  let targetId: string | null = null;
  if (targetType === 'USER' && targetUserId) {
    targetId = targetUserId;
  } else if (targetType === 'TEAM' && targetTeamId) {
    targetId = targetTeamId;
  } else if (targetType === 'SCHEDULE' && targetScheduleId) {
    targetId = targetScheduleId;
  }

  if (!targetId) {
    return { error: `Target ${targetType} is required` };
  }

  // Get current max step order
  const maxStep = await prisma.escalationRule.findFirst({
    where: { policyId },
    orderBy: { stepOrder: 'desc' },
  });

  const nextStepOrder = maxStep ? maxStep.stepOrder + 1 : 0;

  try {
    await prisma.escalationRule.create({
      data: {
        policyId,
        targetType,
        targetUserId: targetType === 'USER' ? targetId : null,
        targetTeamId: targetType === 'TEAM' ? targetId : null,
        targetScheduleId: targetType === 'SCHEDULE' ? targetId : null,
        delayMinutes,
        stepOrder: nextStepOrder,
        notificationChannels:
          notificationChannels.length > 0 ? (notificationChannels as any[]) : [], // eslint-disable-line @typescript-eslint/no-explicit-any
        notifyOnlyTeamLead: targetType === 'TEAM' ? notifyOnlyTeamLead : false,
      },
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

  const targetType = (formData.get('targetType') as 'USER' | 'TEAM' | 'SCHEDULE') || undefined;
  const targetUserId = formData.get('targetUserId') as string | null;
  const targetTeamId = formData.get('targetTeamId') as string | null;
  const targetScheduleId = formData.get('targetScheduleId') as string | null;
  const delayMinutes = parseInt((formData.get('delayMinutes') as string) || '0');

  // Get notification channels from form (checkboxes)
  const notificationChannels = formData.getAll('notificationChannels') as string[];
  // Default to empty array if none selected (will use user preferences)
  const finalChannels = notificationChannels.length > 0 ? notificationChannels : [];

  // Get notify only team lead option
  const notifyOnlyTeamLead = formData.get('notifyOnlyTeamLead') === 'true';

  const step = await prisma.escalationRule.findUnique({
    where: { id: stepId },
    include: { policy: true },
  });

  if (!step) {
    throw new Error('Escalation step not found');
  }

  // Use existing targetType if not provided
  const finalTargetType = targetType || step.targetType;

  // Validate that appropriate target ID is provided
  let targetId: string | null = null;
  if (finalTargetType === 'USER' && targetUserId) {
    targetId = targetUserId;
  } else if (finalTargetType === 'TEAM' && targetTeamId) {
    targetId = targetTeamId;
  } else if (finalTargetType === 'SCHEDULE' && targetScheduleId) {
    targetId = targetScheduleId;
  } else {
    // Fallback to existing values
    targetId = step.targetUserId || step.targetTeamId || step.targetScheduleId || null;
  }

  if (!targetId) {
    return { error: `Target ${finalTargetType} is required` };
  }

  const updateData: any = {
    targetType: finalTargetType,
    targetUserId: finalTargetType === 'USER' ? targetId : null,
    targetTeamId: finalTargetType === 'TEAM' ? targetId : null,
    targetScheduleId: finalTargetType === 'SCHEDULE' ? targetId : null,
    delayMinutes,
    notificationChannels: finalChannels as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    notifyOnlyTeamLead: finalTargetType === 'TEAM' ? notifyOnlyTeamLead : false,
  };

  try {
    await prisma.escalationRule.update({
      where: { id: stepId },
      data: updateData,
    });

    await logAudit({
      action: 'escalation_policy.step_updated',
      entityType: 'ESCALATION_POLICY',
      entityId: step.policyId,
      actorId: currentUser.id,
      details: { stepId, stepOrder: step.stepOrder, targetType: finalTargetType },
    });

    revalidatePath(`/policies/${step.policyId}`);
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
    await prisma.escalationRule.delete({
      where: { id: stepId },
    });

    // Reorder remaining steps
    const remainingSteps = await prisma.escalationRule.findMany({
      where: { policyId },
      orderBy: { stepOrder: 'asc' },
    });

    // Update step orders to be sequential
    for (let i = 0; i < remainingSteps.length; i++) {
      if (remainingSteps[i].stepOrder !== i) {
        await prisma.escalationRule.update({
          where: { id: remainingSteps[i].id },
          data: { stepOrder: i },
        });
      }
    }

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

  try {
    // Swap step orders
    await prisma.$transaction([
      prisma.escalationRule.update({
        where: { id: stepId },
        data: { stepOrder: newOrder },
      }),
      prisma.escalationRule.update({
        where: { id: targetStep.id },
        data: { stepOrder: currentOrder },
      }),
    ]);

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

export async function reorderPolicySteps(
  policyId: string,
  newOrder: string[]
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  try {
    await prisma.$transaction(async tx => {
      // Verify all steps belong to the policy
      const steps = await tx.escalationRule.findMany({
        where: {
          policyId,
          id: { in: newOrder },
        },
        select: { id: true, stepOrder: true },
      });

      if (steps.length !== newOrder.length) {
        throw new Error('Invalid step IDs provided for reordering');
      }

      // Update each step in 'newOrder' to its new stepOrder position
      for (let i = 0; i < newOrder.length; i++) {
        await tx.escalationRule.update({
          where: { id: newOrder[i] },
          data: {
            stepOrder: i,
          },
        });
      }
    });

    await logAudit({
      action: 'escalation_policy.steps_reordered',
      entityType: 'ESCALATION_POLICY',
      entityId: policyId,
      actorId: currentUser.id,
      details: { newOrderCount: newOrder.length },
    });

    revalidatePath(`/policies/${policyId}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to reorder escalation steps' };
  }
}
