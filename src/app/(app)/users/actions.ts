'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { randomBytes, createHash } from 'crypto';
import { assertAdmin, assertAdminOrTeamOwner, assertNotSelf, getCurrentUser } from '@/lib/rbac';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { isAppRole } from '@/lib/authorization';
import type { Role } from '@prisma/client';
import { removeTeamMembership } from '@/lib/teams/membership-commands';
import {
  dependencySummary,
  discoverUserDependencies,
  type UserDependencyReport,
} from '@/lib/users/dependencies';
import { bulkUpdateUserSecurityState, updateUserSecurityState } from '@/lib/users/admin-invariants';
import { requireOperationalUser } from '@/lib/users/operational-eligibility';

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

async function assertUserIsNotSoleOwner(userId: string) {
  const ownedMemberships = await prisma.teamMember.findMany({
    where: { userId, role: 'OWNER' },
    select: { teamId: true },
  });

  if (ownedMemberships.length === 0) return;

  const teamIds = ownedMemberships.map(membership => membership.teamId);
  const ownerCounts = await prisma.teamMember.groupBy({
    by: ['teamId'],
    where: {
      teamId: { in: teamIds },
      role: 'OWNER',
    },
    _count: { _all: true },
  });

  const soleOwnerTeamIds = ownerCounts
    .filter(entry => entry._count._all === 1)
    .map(entry => entry.teamId);

  if (soleOwnerTeamIds.length > 0) {
    throw new Error('Reassign team ownership before deleting this user.');
  }
}

async function assertNotLastAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  // Only check if the user being deleted is an admin
  if (user?.role !== 'ADMIN') return;

  const adminCount = await prisma.user.count({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  if (adminCount <= 1) {
    throw new Error('Cannot delete the last admin user. Create another admin first.');
  }
}

async function assertBatchLeavesActiveAdmin(userIds: string[]) {
  const targetedAdminCount = await prisma.user.count({
    where: {
      id: { in: userIds },
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  if (targetedAdminCount === 0) return;

  const totalActiveAdmins = await prisma.user.count({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  if (totalActiveAdmins - targetedAdminCount < 1) {
    throw new Error('Operation would leave the system with no active administrators.');
  }
}

async function deleteUserInternal(userId: string) {
  await assertUserIsNotSoleOwner(userId);
  await assertNotLastAdmin(userId);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) throw new Error('User not found.');
  if (user.status !== 'DISABLED') {
    throw new Error('Deactivate the user before permanent deletion.');
  }
  const dependencies = dependencySummary(await discoverUserDependencies(userId));
  if (dependencies.length > 0) {
    throw new Error(
      `Resolve or transfer user dependencies before deletion (${dependencies.join(', ')}).`
    );
  }

  await prisma.$transaction([
    // Preserve incident notes for audit trail — nullify userId so notes survive user deletion
    prisma.incidentNote.updateMany({ where: { userId }, data: { userId: null } }),
    prisma.incidentWatcher.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
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

async function createInviteToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const identifier = email.toLowerCase();

  await prisma.$transaction(async tx => {
    const rotated = await tx.user.update({
      where: { id: userId, status: 'INVITED' },
      data: { invitedAt: new Date(), invitationGeneration: { increment: 1 } },
      select: { invitationGeneration: true },
    });
    await tx.userToken.updateMany({
      where: { userId, type: 'INVITE', usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userToken.create({
      data: {
        identifier,
        userId,
        generation: rotated.invitationGeneration,
        type: 'INVITE',
        tokenHash,
        expiresAt: expires,
      },
    });
  });

  const baseUrl = getBaseUrl();
  const inviteUrl = `${baseUrl}/set-password?token=${encodeURIComponent(token)}`;

  return inviteUrl;
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

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: 'Please enter a valid email address (e.g., name@company.com).' };
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    // Rate Limit (Admin Abuse Protection)
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const realIp = headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown';

    const { checkRateLimit } = await import('@/lib/password-reset');
    // Limit admin creating users
    if (admin) {
      await checkRateLimit(email, realIp, 'user.invited');
    }

    if (existing?.status === 'DISABLED') {
      return { error: 'User is disabled. Reactivate before adding again.' };
    }

    if (existing) {
      return { error: 'A user with that email already exists.' };
    }

    let inviteUrl = '';
    const user = await prisma.$transaction(async tx => {
      const newUser = await tx.user.create({
        data: {
          name,
          email,
          role,
          status: 'INVITED',
          invitedAt: new Date(),
          invitationGeneration: 1,
        },
      });

      // Inline token creation to use TX
      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const identifier = email.toLowerCase();

      await tx.userToken.deleteMany({
        where: { identifier, type: 'INVITE', usedAt: null },
      });

      await tx.userToken.create({
        data: {
          identifier,
          userId: newUser.id,
          generation: newUser.invitationGeneration,
          type: 'INVITE',
          tokenHash,
          expiresAt: expires,
        },
      });

      const baseUrl = getBaseUrl();
      inviteUrl = `${baseUrl}/set-password?token=${encodeURIComponent(token)}`;

      return newUser;
    });

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
  if (role !== 'ADMIN') {
    try {
      await assertNotLastAdmin(userId);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Cannot demote the last admin.',
      };
    }
  }

  await updateUserSecurityState(userId, { role }, { tokenVersion: { increment: 1 } });

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
    await assertNotLastAdmin(userId);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }
  await updateUserSecurityState(
    userId,
    { status: 'DISABLED' },
    {
      deactivatedAt: new Date(),
      tokenVersion: { increment: 1 },
      invitationGeneration: { increment: 1 },
    }
  );
  await prisma.$transaction([
    prisma.userToken.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.apiKey.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.oidcLinkingApproval.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.userDevice.deleteMany({ where: { userId } }),
  ]);
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
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, passwordHash: true },
  });
  if (!target) return { error: 'User not found.' };
  if (target.status !== 'DISABLED') return { error: 'Only disabled users can be reactivated.' };

  await prisma.user.update({
    where: { id: userId },
    data: {
      status: target.passwordHash ? 'ACTIVE' : 'INVITED',
      deactivatedAt: null,
      tokenVersion: { increment: 1 },
    },
  });

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

  const inviteUrl = await createInviteToken(user.id, user.email);

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

    await deleteUserInternal(userId);

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
  const userIds = formData.getAll('userIds').filter(Boolean) as string[];

  if (!action) {
    return { error: 'Choose a bulk action first.' };
  }

  if (userIds.length === 0) {
    return { error: 'Select at least one user.' };
  }

  if (action === 'activate') {
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        status: 'ACTIVE',
        deactivatedAt: null,
      },
    });

    await logAudit({
      action: 'user.reactivated.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: { userIds, count: userIds.length },
    });
  } else if (action === 'deactivate') {
    if (admin && userIds.includes(admin.id)) {
      return { error: 'You cannot deactivate your own account.' };
    }

    try {
      await assertBatchLeavesActiveAdmin(userIds);
      for (const userId of userIds) {
        await assertNotLastAdmin(userId);
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Cannot deactivate the last admin.',
      };
    }

    await bulkUpdateUserSecurityState(
      userIds,
      { status: 'DISABLED' },
      {
        deactivatedAt: new Date(),
        tokenVersion: { increment: 1 },
        invitationGeneration: { increment: 1 },
      }
    );
    await prisma.userToken.updateMany({
      where: { userId: { in: userIds }, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.apiKey.updateMany({
      where: { userId: { in: userIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.oidcLinkingApproval.updateMany({
      where: { userId: { in: userIds }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.userDevice.deleteMany({ where: { userId: { in: userIds } } });

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

    try {
      await assertBatchLeavesActiveAdmin(userIds);
      for (const userId of userIds) {
        await assertUserIsNotSoleOwner(userId);
        await assertNotLastAdmin(userId);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unable to delete selected users.' };
    }

    const usersToDelete = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true, role: true },
    });

    // Cannot use deleteMany due to complex cascade logic (needs deleteUserInternal)
    const deletionResults = await Promise.allSettled(
      userIds.map(async id => {
        await deleteUserInternal(id);
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

    if (role !== 'ADMIN') {
      if (admin && userIds.includes(admin.id)) {
        return { error: 'You cannot demote your own admin account.' };
      }
      try {
        await assertBatchLeavesActiveAdmin(userIds);
        for (const userId of userIds) {
          await assertNotLastAdmin(userId);
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Cannot demote the last admin.' };
      }
    }

    await bulkUpdateUserSecurityState(userIds, { role }, { tokenVersion: { increment: 1 } });

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
  const isAdmin = currentUser.role === 'ADMIN';

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

  // Check email uniqueness if email is changed
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

  // Role validation
  let targetRole = existingUser.role;
  if (role && isAppRole(role)) {
    if (!isAdmin && role !== existingUser.role) {
      return { error: 'Only administrators can change user roles.' };
    }
    if (isAdmin) {
      if (existingUser.role === 'ADMIN' && role !== 'ADMIN') {
        try {
          await assertNotLastAdmin(userId);
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Cannot demote the last admin.' };
        }
      }
      targetRole = role as Role;
    }
  }

  try {
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.user.update({
        where: { id: userId },
        data: {
          name: name.trim(),
          email: normalizedEmail,
          role: targetRole,
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
                whatsappNotificationsEnabled:
                  formData.get('whatsappNotificationsEnabled') === 'true',
              }
            : {}),
          ...(targetRole !== existingUser.role || emailChanged
            ? { tokenVersion: { increment: 1 } }
            : {}),
          ...(emailChanged ? { invitationGeneration: { increment: 1 } } : {}),
        },
      });
      if (emailChanged) {
        await tx.userToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
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
