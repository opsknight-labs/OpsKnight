'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { assignTeamServices } from '@/lib/teams/service-commands';
import { runSerializableTransaction } from '@/lib/db-utils';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { assertAdminOrResponder, assertAdmin, assertTeamManager } from '@/lib/rbac';
import { CAPABILITIES, capabilitiesOf } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { assertTeamNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { removeTeamMembership } from '@/lib/teams/membership-commands';
import {
  setTeamMembership,
  patchTeamMembership,
  setTeamLead,
  requireMembershipCoordinates,
  requireTeamAccess,
  teamMemberInput,
  findTeamDeletionBlocker,
} from '@/lib/teams/administration';

const TEAM_ALREADY_DELETED = 'This team no longer exists. It may already have been deleted.';

type TeamFormState = {
  error?: string | null;
  success?: boolean;
};

export async function createTeam(
  _prevState: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  let currentUser: Awaited<ReturnType<typeof assertAdminOrResponder>>;
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

  let team: Awaited<ReturnType<typeof prisma.team.create>>;
  try {
    team = await prisma.team.create({
      data: {
        name: normalizedName,
        description: description || null,
        // Only organisation admins can manage a team they are not on, so anyone else who creates
        // one owns it. Otherwise nobody could ever add a member to it.
        ...(capabilitiesOf(currentUser).includes(CAPABILITIES.ADMIN_MANAGE)
          ? {}
          : { members: { create: { userId: currentUser.id, role: 'OWNER' as const } } }),
      },
    });
  } catch (error) {
    // A concurrent create of the same name passes the check above and loses on the unique index.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'A team with that name already exists.' };
    }
    throw error;
  }

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
    currentUser = await assertTeamManager(teamId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or Team Owner access required.',
    };
  }
  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const teamLeadId = formData.get('teamLeadId') as string;

  let normalizedName = name;
  try {
    normalizedName = await assertTeamNameAvailable(name, { excludeId: teamId });
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      return { error: 'A team with that name already exists.' };
    }
    return { error: error instanceof Error ? error.message : 'Failed to validate team name.' };
  }

  const actorId = currentUser.id;
  try {
    await runSerializableTransaction(async tx => {
      await requireTeamAccess(tx, teamId, { id: actorId }, true);
      await setTeamLead(teamId, { userId: teamLeadId || null }, { id: actorId }, { client: tx });
      await tx.team.update({
        where: { id: teamId },
        data: { name: normalizedName, description: description || null },
      });
      await logAudit(
        {
          action: 'team.updated',
          entityType: 'TEAM',
          entityId: teamId,
          actorId,
          details: { name: normalizedName },
        },
        tx
      );
    });
  } catch (error) {
    // Show the rule that was broken (inactive lead, lost access, name taken in a race) in the form.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'A team with that name already exists.' };
    }
    if (error instanceof AppError) return { error: error.userMessage };
    throw error;
  }

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
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  if (!team) return { error: TEAM_ALREADY_DELETED };
  const blocker = await findTeamDeletionBlocker(teamId);
  if (blocker) return { error: blocker };
  const actorId = currentUser.id;
  try {
    // The audit row commits with the delete: a failed audit rolls the delete back, and a
    // committed delete always has its audit row.
    await prisma.$transaction(async tx => {
      await tx.teamMember.deleteMany({ where: { teamId } });
      await tx.service.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.incident.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.escalationRule.updateMany({
        where: { targetTeamId: teamId },
        data: { targetTeamId: null },
      });
      await tx.dashboard.updateMany({ where: { teamId }, data: { teamId: null } });
      await tx.team.delete({ where: { id: teamId } });
      await logAudit(
        {
          action: 'team.deleted',
          entityType: 'TEAM',
          entityId: teamId,
          actorId,
          details: { name: team.name },
        },
        tx
      );
    });
  } catch (error) {
    // A second delete from another tab loses the race for the row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { error: TEAM_ALREADY_DELETED };
    }
    throw error;
  }

  revalidatePath('/teams');
  revalidatePath('/services');
  revalidatePath('/audit');

  logger.info('team.deleted', { teamId, actorId });
}

export async function addTeamMember(teamId: string, formData: FormData) {
  try {
    const actor = await assertTeamManager(teamId);
    await setTeamMembership(
      teamId,
      String(formData.get('userId') ?? ''),
      teamMemberInput.parse({ role: formData.get('role') || 'MEMBER' }),
      actor
    );
    revalidateTeamAdministration(teamId);
  } catch (error) {
    return teamAdministrationError(error);
  }
}
export async function updateTeamMemberRole(memberId: string, formData: FormData) {
  try {
    const member = await requireMembershipCoordinates(memberId);
    const actor = await assertTeamManager(member.teamId);
    await patchTeamMembership(
      memberId,
      { role: teamMemberInput.shape.role.parse(formData.get('role') || 'MEMBER') },
      actor
    );
    revalidateTeamAdministration(member.teamId);
  } catch (error) {
    return teamAdministrationError(error);
  }
}
export async function updateTeamMemberNotifications(
  memberId: string,
  receiveNotifications: boolean
) {
  try {
    const member = await requireMembershipCoordinates(memberId);
    const actor = await assertTeamManager(member.teamId);
    await patchTeamMembership(memberId, { receiveTeamNotifications: receiveNotifications }, actor);
    revalidateTeamAdministration(member.teamId);
  } catch (error) {
    return teamAdministrationError(error);
  }
}
export async function removeTeamMember(memberId: string) {
  try {
    const member = await requireMembershipCoordinates(memberId);
    const actor = await assertTeamManager(member.teamId);
    await removeTeamMembership(memberId, actor);
    revalidateTeamAdministration(member.teamId);
  } catch (error) {
    return teamAdministrationError(error);
  }
}
export async function designateTeamLead(
  teamId: string,
  userId: string | null
): Promise<{ error?: string; success?: boolean }> {
  try {
    const actor = await assertTeamManager(teamId);
    await setTeamLead(teamId, { userId }, actor);
    revalidateTeamAdministration(teamId);
    return { success: true };
  } catch (error) {
    return teamAdministrationError(error);
  }
}
function revalidateTeamAdministration(teamId: string) {
  for (const path of ['/teams', `/teams/${teamId}`, '/users', '/services', '/audit'])
    revalidatePath(path);
}
function teamAdministrationError(error: unknown) {
  return { error: error instanceof Error ? error.message : 'Team administration failed.' };
}

export async function assignServicesToTeam(
  teamId: string,
  serviceIds: string[]
): Promise<{ error?: string; success?: boolean }> {
  try {
    const actor = await assertTeamManager(teamId);
    await assignTeamServices(teamId, { serviceIds }, actor);
    revalidateTeamAdministration(teamId);
    return { success: true };
  } catch (error) {
    return teamAdministrationError(error);
  }
}
