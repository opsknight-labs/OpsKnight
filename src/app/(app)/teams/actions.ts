'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getDefaultActorId, logAudit } from '@/lib/audit';
import { assertAdminOrResponder, assertAdmin, assertAdminOrTeamOwner } from '@/lib/rbac';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { logger } from '@/lib/logger';
import { assertTeamNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

type TeamFormState = {
  error?: string | null;
  success?: boolean;
};

async function ensureTeamHasOwner(teamId: string, excludeMemberId?: string) {
  const ownerCount = await prisma.teamMember.count({
    where: {
      teamId,
      role: 'OWNER',
      ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
    },
  });

  if (ownerCount === 0) {
    throw new Error('Each team must have at least one owner.');
  }
}

export async function createTeam(
  _prevState: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const description = (formData.get('description') as string | null)?.trim() ?? '';

  if (!name) {
    return { error: 'Team name is required.' };
  }

  let normalizedName = name;
  try {
    normalizedName = await assertTeamNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return { error: 'A team with that name already exists.' };
    }
    return { error: error instanceof Error ? error.message : 'Failed to validate team name.' };
  }

  const team = await prisma.team.create({
    data: {
      name: normalizedName,
      description: description || null,
    },
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.created',
    entityType: 'TEAM',
    entityId: team.id,
    actorId,
    details: { name: normalizedName },
  });

  revalidatePath('/teams');
  revalidatePath('/services');
  revalidatePath('/audit');

  logger.info('team.created', { teamId: team.id, name: normalizedName, actorId });

  return { success: true };
}

export async function updateTeam(teamId: string, formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const teamLeadId = formData.get('teamLeadId') as string;

  // Validate team lead is a team member
  if (teamLeadId) {
    const isMember = await prisma.teamMember.findFirst({
      where: {
        teamId,
        userId: teamLeadId,
      },
    });

    if (!isMember) {
      return { error: 'Team lead must be a team member' };
    }
  }

  let normalizedName = name;
  try {
    normalizedName = await assertTeamNameAvailable(name, { excludeId: teamId });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return { error: 'A team with that name already exists.' };
    }
    return { error: error instanceof Error ? error.message : 'Failed to validate team name.' };
  }

  await prisma.team.update({
    where: { id: teamId },
    data: {
      name: normalizedName,
      description: description || null,
      teamLeadId: teamLeadId || null,
    },
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.updated',
    entityType: 'TEAM',
    entityId: teamId,
    actorId,
    details: { name: normalizedName, teamLeadId: teamLeadId || null },
  });

  revalidatePath('/teams');
  revalidatePath('/services');
  revalidatePath('/audit');

  logger.info('team.updated', {
    teamId,
    name: normalizedName,
    teamLeadId: teamLeadId || null,
    actorId,
  });
}

export async function deleteTeam(teamId: string) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }
  await prisma.teamMember.deleteMany({
    where: { teamId },
  });

  await prisma.service.updateMany({
    where: { teamId },
    data: { teamId: null },
  });

  await prisma.team.delete({
    where: { id: teamId },
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.deleted',
    entityType: 'TEAM',
    entityId: teamId,
    actorId,
  });

  revalidatePath('/teams');
  revalidatePath('/services');
  revalidatePath('/audit');

  logger.info('team.deleted', { teamId, actorId });
}

export async function addTeamMember(teamId: string, formData: FormData) {
  let currentUser;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const userId = formData.get('userId') as string;
  const role = (formData.get('role') as string) || 'MEMBER';

  // Only admins or team owners can assign OWNER/ADMIN roles
  if (role === 'OWNER' || role === 'ADMIN') {
    const isAdmin = currentUser.role === 'ADMIN';
    const isTeamOwner = await prisma.teamMember.findFirst({
      where: {
        teamId,
        userId: currentUser.id,
        role: 'OWNER',
      },
    });

    if (!isAdmin && !isTeamOwner) {
      return { error: 'Only admins or team owners can assign OWNER or ADMIN roles.' };
    }
  }

  if (!userId) return;

  await prisma.teamMember.create({
    data: {
      teamId,
      userId,
      role: role as 'OWNER' | 'ADMIN' | 'MEMBER',
    },
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.member.added',
    entityType: 'TEAM_MEMBER',
    entityId: `${teamId}:${userId}`,
    actorId,
    details: { teamId, userId, role },
  });

  revalidatePath('/teams');
  revalidatePath('/users');
  revalidatePath('/audit');

  logger.info('team.member.added', { teamId, userId, role, actorId });

  // Notify the user
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  if (team) {
    await createInAppNotifications({
      userIds: [userId],
      type: 'TEAM',
      title: 'Added to Team',
      message: `You were added to team "${team.name}" as ${role}`,
      entityType: 'TEAM',
      entityId: teamId,
    });
  }
}

export async function updateTeamMemberRole(
  memberId: string,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  let currentUser;
  try {
    currentUser = await assertAdminOrResponder();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Responder access required.',
    };
  }
  const role = (formData.get('role') as string) || 'MEMBER';

  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    return { error: 'Member not found.' };
  }

  // Only admins or team owners can assign OWNER/ADMIN roles
  if (role === 'OWNER' || role === 'ADMIN') {
    const isAdmin = currentUser.role === 'ADMIN';
    const isTeamOwner = await prisma.teamMember.findFirst({
      where: {
        teamId: member.teamId,
        userId: currentUser.id,
        role: 'OWNER',
      },
    });

    if (!isAdmin && !isTeamOwner) {
      return { error: 'Only admins or team owners can assign OWNER or ADMIN roles.' };
    }
  }

  if (member.role === 'OWNER' && role !== 'OWNER') {
    try {
      await ensureTeamHasOwner(member.teamId, member.id);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Cannot change role of last owner.',
      };
    }
  }

  await prisma.teamMember.update({
    where: { id: memberId },
    data: { role: role as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.member.role.updated',
    entityType: 'TEAM_MEMBER',
    entityId: memberId,
    actorId,
    details: { teamId: member.teamId, userId: member.userId, role },
  });

  revalidatePath('/teams');
  revalidatePath('/users');
  revalidatePath('/audit');

  logger.info('team.member.role.updated', {
    memberId,
    teamId: member.teamId,
    userId: member.userId,
    role,
    actorId,
  });
}

export async function updateTeamMemberNotifications(
  memberId: string,
  receiveNotifications: boolean
): Promise<{ error?: string } | undefined> {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    select: { teamId: true, userId: true },
  });

  if (!member) {
    return { error: 'Member not found.' };
  }

  let currentUser;
  try {
    currentUser = await assertAdminOrTeamOwner(member.teamId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Team Owner access required.',
    };
  }

  await prisma.teamMember.update({
    where: { id: memberId },
    data: { receiveTeamNotifications: receiveNotifications },
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.member.notifications.updated',
    entityType: 'TEAM_MEMBER',
    entityId: memberId,
    actorId,
    details: {
      teamId: member.teamId,
      userId: member.userId,
      receiveTeamNotifications: receiveNotifications,
    },
  });

  revalidatePath('/teams');

  logger.info('team.member.notifications.updated', {
    memberId,
    teamId: member.teamId,
    userId: member.userId,
    receiveTeamNotifications: receiveNotifications,
    actorId,
  });
}

export async function removeTeamMember(memberId: string): Promise<{ error?: string } | undefined> {
  // First get the member to find the team ID
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    include: { team: { select: { name: true } } },
  });

  if (!member) {
    return { error: 'Member not found.' };
  }

  // Check if user is admin or owner of this specific team
  let currentUser;
  try {
    currentUser = await assertAdminOrTeamOwner(member.teamId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Team Owner access required.',
    };
  }

  if (member.role === 'OWNER') {
    try {
      await ensureTeamHasOwner(member.teamId, member.id);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Cannot remove last owner.' };
    }
  }

  await prisma.$transaction(async tx => {
    await tx.teamMember.delete({
      where: { id: memberId },
    });

    // Clear teamLeadId if the removed member was the team lead
    await tx.team.updateMany({
      where: { id: member.teamId, teamLeadId: member.userId },
      data: { teamLeadId: null },
    });
  });

  const actorId = currentUser.id;
  await logAudit({
    action: 'team.member.removed',
    entityType: 'TEAM_MEMBER',
    entityId: memberId,
    actorId,
    details: { teamId: member.teamId, userId: member.userId },
  });

  revalidatePath('/teams');
  revalidatePath('/users');
  revalidatePath('/audit');

  logger.info('team.member.removed', {
    memberId,
    teamId: member.teamId,
    userId: member.userId,
    actorId,
  });

  // Notify the user
  if (member.team) {
    await createInAppNotifications({
      userIds: [member.userId],
      type: 'TEAM',
      title: 'Removed from Team',
      message: `You were removed from team "${member.team.name}"`,
      entityType: 'TEAM',
      entityId: member.teamId,
    });
  }
}
