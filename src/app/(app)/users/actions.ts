'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { randomBytes, createHash } from 'crypto';
import { assertAdmin, assertAdminOrTeamOwner, assertNotSelf } from '@/lib/rbac';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { revokeUserSessions, getAuthOptions } from '@/lib/auth';
import { isAppRole } from '@/lib/authorization';
import { getServerSession } from 'next-auth';
import type { Role } from '@prisma/client';

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
      status: { not: 'DISABLED' },
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
      status: { not: 'DISABLED' },
    },
  });

  if (targetedAdminCount === 0) return;

  const totalActiveAdmins = await prisma.user.count({
    where: {
      role: 'ADMIN',
      status: { not: 'DISABLED' },
    },
  });

  if (totalActiveAdmins - targetedAdminCount < 1) {
    throw new Error('Operation would leave the system with no active administrators.');
  }
}

async function deleteUserInternal(userId: string) {
  await assertUserIsNotSoleOwner(userId);
  await assertNotLastAdmin(userId);

  await prisma.$transaction([
    prisma.incident.updateMany({
      where: { assigneeId: userId },
      data: { assigneeId: null },
    }),
    prisma.teamMember.deleteMany({ where: { userId } }),
    prisma.onCallLayerUser.deleteMany({ where: { userId } }),
    prisma.onCallOverride.deleteMany({ where: { OR: [{ userId }, { replacesUserId: userId }] } }),
    prisma.onCallShift.deleteMany({ where: { userId } }),
    prisma.escalationRule.deleteMany({ where: { targetUserId: userId } }),
    // Preserve incident notes for audit trail — nullify userId so notes survive user deletion
    prisma.incidentNote.updateMany({ where: { userId }, data: { userId: null } }),
    // Notifications are delivery receipts and less useful without the user
    prisma.notification.deleteMany({ where: { userId } }),
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

async function createInviteToken(email: string) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const identifier = email.toLowerCase();

  await prisma.userToken.deleteMany({
    where: { identifier, type: 'INVITE', usedAt: null },
  });

  await prisma.userToken.create({
    data: {
      identifier,
      type: 'INVITE',
      tokenHash,
      expiresAt: expires,
    },
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
      await checkRateLimit(admin.email, realIp, 'ADMIN_ADD_USER');
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

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });
  await revokeUserSessions(userId);

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

  await prisma.teamMember.create({
    data: {
      userId,
      teamId,
      role: (role as 'OWNER' | 'ADMIN' | 'MEMBER') || 'MEMBER',
    },
  });

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
  const member = await prisma.teamMember.delete({
    where: { id: memberId },
  });

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
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'DISABLED',
      deactivatedAt: new Date(),
    },
  });
  if (typeof prisma.onCallOverride?.deleteMany === 'function') {
    await prisma.onCallOverride.deleteMany({
      where: {
        userId,
        end: { gte: new Date() },
      },
    });
  }
  await revokeUserSessions(userId);

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
  await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'ACTIVE',
      deactivatedAt: null,
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

  // Rate Limit (Admin Abuse Protection)
  const { headers } = await import('next/headers');
  const headerList = await headers();
  const realIp = headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown';

  const { checkRateLimit } = await import('@/lib/password-reset');
  // Limit resend invites
  if (admin) {
    await checkRateLimit(admin.email, realIp, 'ADMIN_RESEND_INVITE');
  }

  if (!user) {
    return { error: 'User not found.' };
  }

  if (user.status === 'DISABLED') {
    return { error: 'User is disabled. Reactivate before inviting.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      status: 'INVITED',
      invitedAt: new Date(),
    },
  });

  const inviteUrl = await createInviteToken(user.email);

  await logAudit({
    action: 'user.invite.resent',
    entityType: 'USER',
    entityId: user.id,
    actorId: admin?.id || null,
    details: { email: user.email },
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

    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: {
        status: 'DISABLED',
        deactivatedAt: new Date(),
      },
    });

    if (typeof prisma.onCallOverride?.deleteMany === 'function') {
      await prisma.onCallOverride.deleteMany({
        where: {
          userId: { in: userIds },
          end: { gte: new Date() },
        },
      });
    }

    await Promise.all(userIds.map(id => revokeUserSessions(id)));

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

    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { role },
    });

    await Promise.all(userIds.map(id => revokeUserSessions(id)));

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
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    return { error: 'Unauthorized. Please log in.' };
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });

  if (!currentUser) {
    return { error: 'User session not found.' };
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
  const emailNotificationsEnabled = formData.get('emailNotificationsEnabled') === 'true';
  const smsNotificationsEnabled = formData.get('smsNotificationsEnabled') === 'true';
  const pushNotificationsEnabled = formData.get('pushNotificationsEnabled') === 'true';
  const whatsappNotificationsEnabled = formData.get('whatsappNotificationsEnabled') === 'true';

  if (!name || name.trim().length === 0) {
    return { error: 'Name is required.' };
  }
  if (!email || !email.includes('@')) {
    return { error: 'Valid email is required.' };
  }

  // Check email uniqueness if email is changed
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true },
  });

  if (!existingUser) {
    return { error: 'User not found.' };
  }

  if (email.toLowerCase() !== existingUser.email.toLowerCase()) {
    const emailConflict = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
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
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: targetRole,
        department: department?.trim() || null,
        jobTitle: jobTitle?.trim() || null,
        timeZone: timeZone?.trim() || 'UTC',
        phoneNumber: phoneNumber?.trim() || null,
        emailNotificationsEnabled,
        smsNotificationsEnabled,
        pushNotificationsEnabled,
        whatsappNotificationsEnabled,
      },
    });

    if (targetRole !== existingUser.role) {
      await revokeUserSessions(userId);
    }

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
