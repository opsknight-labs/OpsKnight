'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { assertAdmin, assertAdminOrTeamOwner, assertNotSelf, getCurrentUser } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability, isAppRole } from '@/lib/authorization';
import type { Prisma, Role } from '@prisma/client';
import { removeTeamMembership } from '@/lib/teams/membership-commands';
import { discoverUserDependencies, type UserDependencyReport } from '@/lib/users/dependencies';
import { requireOperationalUser } from '@/lib/users/operational-eligibility';
import {
  createInvitedUser,
  deactivateUserAccount,
  deactivateUserAccounts,
  deleteUserAccount,
  reactivateUserAccount,
  rotateUserInvite,
  updateUserRoleAccount,
  updateUserRoleAccounts,
} from '@/lib/users/lifecycle';

async function sendInviteEmailIfConfigured(data: {
  userId: string;
  email: string;
  name: string;
  inviteUrl: string;
  invitedBy?: string;
}): Promise<boolean> {
  try {
    const { getEmailConfig } = await import('@/lib/notification-providers');
    const emailConfig = await getEmailConfig();

    if (!emailConfig.enabled || !emailConfig.provider) {
      return false;
    }

    const { getUserInviteEmailTemplate } = await import('@/lib/user-invite-email-template');
    const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
    const template = getUserInviteEmailTemplate({
      userName: data.name,
      inviteUrl: data.inviteUrl,
      invitedBy: data.invitedBy,
    });

    const result = await enqueueCentralNotification({
      category: 'ADMINISTRATION',
      channel: 'EMAIL',
      recipientType: 'USER',
      recipientId: data.userId,
      recipientAddress: data.email,
      userId: data.userId,
      templateKey: 'user-invitation',
      sourceType: 'USER_INVITATION',
      sourceId: data.userId,
      eventKey: data.inviteUrl,
      displayMessage: 'Workspace invitation',
      priority: 2,
      payload: {
        kind: 'EMAIL',
        to: data.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
    });
    return result.delivered === true;
  } catch (error) {
    logger.warn('Failed to send invite email', {
      component: 'users-actions',
      error,
      email: data.email,
    });
    return false;
  }
}

export type UserFormState = {
  error?: string | null;
  success?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
};

export async function getUserDependencyReport(
  userId: string
): Promise<{ report?: UserDependencyReport; error?: string }> {
  try {
    await assertAdmin();
    return { report: await discoverUserDependencies(userId) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to inspect user dependencies.',
    };
  }
}

export async function addUser(
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  let admin: { id: string; email: string; name: string | null } | null = null;
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim().toLowerCase() ?? '';
  const role = formData.get('role') as string;

  if (!name || !email) {
    return { error: 'Name and email are required.' };
  }
  if (!isAppRole(role)) {
    return { error: 'Select a valid user role.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: 'Please enter a valid email address (e.g., name@company.com).' };
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    const { headers } = await import('next/headers');
    const headerList = await headers();
    const realIp = headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown';

    const { checkRateLimit } = await import('@/lib/password-reset');
    if (admin) {
      await checkRateLimit(email, realIp, 'user.invited');
    }

    if (existing?.status === 'DISABLED') {
      return { error: 'User is disabled. Reactivate before adding again.' };
    }

    if (existing) {
      return { error: 'A user with that email already exists.' };
    }

    const { user, inviteUrl } = await createInvitedUser({ name, email, role: role as Role });

    await logAudit({
      action: 'user.invited',
      entityType: 'USER',
      entityId: user.id,
      actorId: admin?.id || null,
      details: { email, role: role || 'USER' },
      targetEmail: email,
    });

    revalidatePath('/users');
    revalidatePath('/audit');

    const emailSent = await sendInviteEmailIfConfigured({
      userId: user.id,
      email,
      name,
      inviteUrl,
      invitedBy: admin?.name || admin?.email || undefined,
    });

    return { success: true, inviteUrl, emailSent };
  } catch (error) {
    logger.error('Failed to add user', { component: 'users-actions', error, email, name, role });
    return {
      error: error instanceof Error ? error.message : 'Failed to create user or generate invite.',
    };
  }
}

export async function updateUserRole(userId: string, formData: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
    assertNotSelf(currentUser.id, userId, 'change the role of');
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }
  const role = formData.get('role') as string;
  if (!isAppRole(role)) {
    return { error: 'Select a valid user role.' };
  }

  try {
    await updateUserRoleAccount(userId, role as Role);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update user role.' };
  }

  await logAudit({
    action: 'user.role.updated',
    entityType: 'USER',
    entityId: userId,
    actorId: currentUser?.id || null,
    details: { role },
  });

  revalidatePath('/users');
  revalidatePath('/audit');
}

export async function addUserToTeam(userId: string, formData: FormData) {
  const teamId = formData.get('teamId') as string;
  if (!teamId) return;

  let currentUser: { id: string; role?: string } | null = null;
  try {
    currentUser = await assertAdminOrTeamOwner(teamId);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unauthorized. Admin or team owner access required.',
    };
  }
  const requestedRole = (formData.get('role') as string) || 'MEMBER';
  const role = ['OWNER', 'ADMIN', 'MEMBER'].includes(requestedRole) ? requestedRole : 'MEMBER';

  const existing = await prisma.teamMember.findFirst({
    where: { teamId, userId },
  });

  if (existing) return;

  await prisma.$transaction(
    async tx => {
      await requireOperationalUser(tx, userId);
      await tx.teamMember.create({
        data: { userId, teamId, role: role as 'OWNER' | 'ADMIN' | 'MEMBER' },
      });
    },
    { isolationLevel: 'Serializable' }
  );

  await logAudit({
    action: 'team.member.added',
    entityType: 'TEAM_MEMBER',
    entityId: `${teamId}:${userId}`,
    actorId: currentUser?.id || null,
    details: { teamId, userId, role: role || 'MEMBER' },
  });

  revalidatePath('/users');
  revalidatePath('/teams');
  revalidatePath('/audit');
}

export async function removeUserFromTeam(memberId: string) {
  const currentUser = await assertAdmin();
  const member = await removeTeamMembership(memberId);

  await logAudit({
    action: 'team.member.removed',
    entityType: 'TEAM_MEMBER',
    entityId: memberId,
    actorId: currentUser.id,
    details: { teamId: member.teamId, userId: member.userId },
  });

  revalidatePath('/users');
  revalidatePath('/teams');
  revalidatePath('/audit');
}

export async function deactivateUser(userId: string, _formData?: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
    assertNotSelf(currentUser.id, userId, 'deactivate');
    await deactivateUserAccount(userId);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  await logAudit({
    action: 'user.deactivated',
    entityType: 'USER',
    entityId: userId,
    actorId: currentUser?.id || null,
  });

  revalidatePath('/users');
  revalidatePath('/audit');
}

export async function reactivateUser(userId: string, _formData?: FormData) {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
    await reactivateUserAccount(userId);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  await logAudit({
    action: 'user.reactivated',
    entityType: 'USER',
    entityId: userId,
    actorId: currentUser?.id || null,
  });

  revalidatePath('/users');
  revalidatePath('/audit');
}

export async function generateInvite(
  userId: string,
  _prevState: UserFormState,
  _formData: FormData
): Promise<UserFormState> {
  let admin: { id: string; email: string; name: string | null } | null = null;
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return { error: 'User not found.' };
  }

  if (user.status !== 'INVITED') {
    return {
      error:
        user.status === 'DISABLED'
          ? 'User is disabled. Reactivate before inviting.'
          : 'Active users must use password recovery instead of an invitation.',
    };
  }

  const { headers } = await import('next/headers');
  const headerList = await headers();
  const realIp = headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown';
  const { checkRateLimit } = await import('@/lib/password-reset');
  await checkRateLimit(user.email, realIp, 'user.invite.resent');

  let inviteUrl: string;
  try {
    inviteUrl = await rotateUserInvite(user.id, user.email);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to rotate invitation.' };
  }

  await logAudit({
    action: 'user.invite.resent',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin?.id || null,
    details: { email: user.email },
    targetEmail: user.email,
  });

  revalidatePath('/users');
  revalidatePath('/audit');

  const emailSent = await sendInviteEmailIfConfigured({
    userId: user.id,
    email: user.email,
    name: user.name || user.email,
    inviteUrl,
    invitedBy: admin?.name || admin?.email || undefined,
  });

  return { success: true, inviteUrl, emailSent };
}

export async function deleteUser(
  userId: string,
  _formData?: FormData
): Promise<{ error?: string } | undefined> {
  let currentUser: { id: string } | null = null;
  try {
    currentUser = await assertAdmin();
    assertNotSelf(currentUser.id, userId, 'delete');
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  try {
    const userToDelete = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, role: true },
    });

    await deleteUserAccount(userId);

    await logAudit({
      action: 'user.deleted',
      entityType: 'USER',
      entityId: userId,
      actorId: currentUser?.id || null,
      targetEmail: userToDelete?.email,
      details: {
        email: userToDelete?.email,
        name: userToDelete?.name,
        role: userToDelete?.role,
      },
    });

    revalidatePath('/users');
    revalidatePath('/audit');
    revalidatePath('/incidents');
    revalidatePath('/schedules');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to delete user.' };
  }
}

type BulkUserActionState = {
  error?: string | null;
  success?: boolean;
  message?: string;
};

export async function bulkUpdateUsers(
  _prevState: BulkUserActionState,
  formData: FormData
): Promise<BulkUserActionState> {
  let admin: { id: string } | null = null;
  try {
    admin = await assertAdmin();
  } catch {
    return { error: 'Unauthorized. Admin access required.' };
  }
  const action = formData.get('bulkAction') as string;
  const userIds = [...new Set(formData.getAll('userIds').filter(Boolean) as string[])];

  if (!action) {
    return { error: 'Choose a bulk action first.' };
  }

  if (userIds.length === 0) {
    return { error: 'Select at least one user.' };
  }

  if (action === 'activate') {
    const results = await Promise.allSettled(userIds.map(id => reactivateUserAccount(id)));
    const activatedIds = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [userIds[index]] : []
    );
    const failedCount = userIds.length - activatedIds.length;

    await logAudit({
      action: 'user.reactivated.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: { userIds: activatedIds, count: activatedIds.length, failedCount },
    });

    revalidatePath('/users');
    if (failedCount > 0) {
      return {
        error: `Reactivated ${activatedIds.length} user(s), but ${failedCount} user(s) could not be reactivated.`,
      };
    }
    return { success: true, message: `Reactivated ${activatedIds.length} user(s)` };
  } else if (action === 'deactivate') {
    if (admin && userIds.includes(admin.id)) {
      return { error: 'You cannot deactivate your own account.' };
    }

    try {
      await deactivateUserAccounts(userIds);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to deactivate selected users.',
      };
    }

    await logAudit({
      action: 'user.deactivated.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: { userIds, count: userIds.length },
    });

    revalidatePath('/users');
    return { success: true, message: `Deactivated ${userIds.length} user(s)` };
  } else if (action === 'delete') {
    if (admin && userIds.includes(admin.id)) {
      return { error: 'You cannot delete your own account.' };
    }

    const usersToDelete = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, role: true },
    });

    const deletionResults = await Promise.allSettled(
      userIds.map(async id => {
        await deleteUserAccount(id);
        return id;
      })
    );
    const deletedIds = deletionResults.flatMap(result =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const failedCount = userIds.length - deletedIds.length;

    await logAudit({
      action: 'user.deleted.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: {
        userIds: deletedIds,
        count: deletedIds.length,
        failedCount,
        users: usersToDelete
          .filter(user => deletedIds.includes(user.id))
          .map(u => ({ email: u.email, name: u.name, role: u.role })),
      },
    });

    revalidatePath('/users');
    if (failedCount > 0) {
      return {
        error: `Deleted ${deletedIds.length} user(s), but ${failedCount} deletion(s) failed. Review the audit log and retry.`,
      };
    }
    return { success: true, message: `Deleted ${deletedIds.length} user(s)` };
  } else if (action === 'setRole') {
    const role = formData.get('role') as string;
    if (!role) {
      return { error: 'Role is required.' };
    }
    if (!isAppRole(role)) {
      return { error: 'Select a valid user role.' };
    }

    if (role !== 'ADMIN' && admin && userIds.includes(admin.id)) {
      return { error: 'You cannot demote your own admin account.' };
    }

    try {
      await updateUserRoleAccounts(userIds, role as Role);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to update selected roles.' };
    }

    await logAudit({
      action: 'user.role.updated.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: { role, userIds, count: userIds.length },
    });

    revalidatePath('/users');
    return { success: true, message: `Updated role for ${userIds.length} user(s)` };
  }

  return { error: 'Unsupported bulk action.' };
}

export async function updateUserProfile(
  userId: string,
  formData: FormData
): Promise<{ error?: string; success?: boolean } | undefined> {
  let currentUser;
  try {
    currentUser = await getCurrentUser();
  } catch {
    return { error: 'Unauthorized. Please log in.' };
  }

  const isSelf = currentUser.id === userId;
  const isAdmin = hasCapability(currentUser.role, CAPABILITIES.ADMIN_MANAGE);

  if (!isAdmin && !isSelf) {
    return { error: 'Unauthorized. You can only edit your own profile.' };
  }

  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const role = formData.get('role') as string | null;
  const department = formData.get('department') as string | null;
  const jobTitle = formData.get('jobTitle') as string | null;
  const timeZone = formData.get('timeZone') as string | null;
  const phoneNumber = formData.get('phoneNumber') as string | null;

  if (!name || name.trim().length === 0) {
    return { error: 'Name is required.' };
  }
  if (!email || !email.includes('@')) {
    return { error: 'Valid email is required.' };
  }
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() }).format();
    } catch {
      return { error: 'Select a valid time zone.' };
    }
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true },
  });

  if (!existingUser) {
    return { error: 'User not found.' };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailChanged = normalizedEmail !== existingUser.email.toLowerCase();
  if (emailChanged) {
    if (!isAdmin) {
      return { error: 'Email changes require administrator verification.' };
    }
    const emailConflict = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (emailConflict) {
      return { error: 'A user with this email address already exists.' };
    }
  }

  let targetRole = existingUser.role;
  if (role && isAppRole(role)) {
    if (!isAdmin && role !== existingUser.role) {
      return { error: 'Only administrators can change user roles.' };
    }
    if (isAdmin) {
      if (role !== existingUser.role) {
        try {
          assertNotSelf(currentUser.id, userId, 'change the role of');
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'You cannot change your own role.' };
        }
      }
      targetRole = role as Role;
    }
  }

  try {
    const roleChanged = targetRole !== existingUser.role;
    const profileData: Prisma.UserUpdateInput = {
      name: name.trim(),
      email: normalizedEmail,
      department: department?.trim() || null,
      jobTitle: jobTitle?.trim() || null,
      timeZone: timeZone?.trim() || 'UTC',
      phoneNumber: phoneNumber?.trim() || null,
      ...(formData.has('emailNotificationsEnabled')
        ? { emailNotificationsEnabled: formData.get('emailNotificationsEnabled') === 'true' }
        : {}),
      ...(formData.has('smsNotificationsEnabled')
        ? { smsNotificationsEnabled: formData.get('smsNotificationsEnabled') === 'true' }
        : {}),
      ...(formData.has('pushNotificationsEnabled')
        ? { pushNotificationsEnabled: formData.get('pushNotificationsEnabled') === 'true' }
        : {}),
      ...(formData.has('whatsappNotificationsEnabled')
        ? {
            whatsappNotificationsEnabled: formData.get('whatsappNotificationsEnabled') === 'true',
          }
        : {}),
      ...(roleChanged || emailChanged ? { tokenVersion: { increment: 1 } } : {}),
      ...(emailChanged ? { invitationGeneration: { increment: 1 } } : {}),
    };
    const revokeInviteTokens = async (tx: Prisma.TransactionClient) => {
      if (emailChanged) {
        await tx.userToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    };
    const updated = roleChanged
      ? await updateUserRoleAccount(userId, targetRole, profileData, revokeInviteTokens)
      : await prisma.$transaction(async tx => {
          const result = await tx.user.update({ where: { id: userId }, data: profileData });
          await revokeInviteTokens(tx);
          return result;
        });

    await logAudit({
      action: 'user.updated',
      entityType: 'USER',
      entityId: userId,
      actorId: currentUser.id,
      details: {
        name: updated.name,
        email: updated.email,
        role: updated.role,
        department: updated.department,
        jobTitle: updated.jobTitle,
      },
    });

    revalidatePath('/users');
    revalidatePath(`/users/${userId}`);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update user profile.' };
  }
}
