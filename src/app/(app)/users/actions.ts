'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getDefaultActorId, logAudit } from '@/lib/audit';
import { randomBytes, createHash } from 'crypto';
import { assertAdmin, assertAdminOrResponder, assertNotSelf } from '@/lib/rbac';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { revokeUserSessions } from '@/lib/auth';

async function sendInviteEmailIfConfigured(data: {
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

    const { sendEmail } = await import('@/lib/email');
    const { getUserInviteEmailTemplate } = await import('@/lib/user-invite-email-template');
    const template = getUserInviteEmailTemplate({
      userName: data.name,
      inviteUrl: data.inviteUrl,
      invitedBy: data.invitedBy,
    });

    const result = await sendEmail(
      {
        to: data.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      },
      emailConfig
    );
    return result.success;
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

async function deleteUserInternal(userId: string) {
  await assertUserIsNotSoleOwner(userId);
  await assertNotLastAdmin(userId);

  await prisma.$transaction([
    prisma.incident.updateMany({
      where: { assigneeId: userId },
      data: { assigneeId: null },
    }),
    prisma.auditLog.updateMany({
      where: { actorId: userId },
      data: { actorId: null },
    }),
    prisma.teamMember.deleteMany({ where: { userId } }),
    prisma.onCallLayerUser.deleteMany({ where: { userId } }),
    prisma.onCallOverride.deleteMany({ where: { OR: [{ userId }, { replacesUserId: userId }] } }),
    prisma.onCallShift.deleteMany({ where: { userId } }),
    prisma.escalationRule.deleteMany({ where: { targetUserId: userId } }),
    prisma.incidentNote.deleteMany({ where: { userId } }),
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
    const ip = 'unknown'; // Server actions don't easily get IP unless passed. Using email limit.
    // Actually we can get headers().
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
    let user: any = null; // Typing as any to avoid Prisma type verbosity in this snippet, or infer it.

    user = await prisma.$transaction(async tx => {
      const newUser = await tx.user.create({
        data: {
          name,
          email,
          role: (role as 'ADMIN' | 'RESPONDER' | 'USER') || 'USER',
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
  await prisma.user.update({
    where: { id: userId },
    data: { role: role as 'ADMIN' | 'RESPONDER' | 'USER' },
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
  const teamId = formData.get('teamId') as string;
  const role = (formData.get('role') as string) || 'MEMBER';

  if (!teamId) return;

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
    await deleteUserInternal(userId);

    await logAudit({
      action: 'user.deleted',
      entityType: 'USER',
      entityId: userId,
      actorId: currentUser?.id || null,
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
    for (const userId of userIds) {
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
        actorId: admin?.id || null,
      });
    }
  } else if (action === 'deactivate') {
    for (const userId of userIds) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          status: 'DISABLED',
          deactivatedAt: new Date(),
        },
      });
      await revokeUserSessions(userId);

      await logAudit({
        action: 'user.deactivated',
        entityType: 'USER',
        entityId: userId,
        actorId: admin?.id || null,
      });
    }
    revalidatePath('/users');
    return { success: true, message: `Deactivated ${userIds.length} user(s)` };
  } else if (action === 'delete') {
    try {
      for (const userId of userIds) {
        await assertUserIsNotSoleOwner(userId);
        await assertNotLastAdmin(userId);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unable to delete selected users.' };
    }

    for (const userId of userIds) {
      await deleteUserInternal(userId);

      await logAudit({
        action: 'user.deleted',
        entityType: 'USER',
        entityId: userId,
        actorId: admin?.id || null,
      });
    }
    revalidatePath('/users');
    return { success: true, message: `Deleted ${userIds.length} user(s)` };
  } else if (action === 'setRole') {
    const role = formData.get('role') as string;
    if (!role) {
      return { error: 'Role is required.' };
    }
    for (const userId of userIds) {
      await prisma.user.update({
        where: { id: userId },
        data: { role: role as 'ADMIN' | 'RESPONDER' | 'USER' },
      });
      await revokeUserSessions(userId);

      await logAudit({
        action: 'user.role.updated',
        entityType: 'USER',
        entityId: userId,
        actorId: admin?.id || null,
        details: { role },
      });
    }
    revalidatePath('/users');
    return { success: true, message: `Updated role for ${userIds.length} user(s)` };
  }

  return { error: 'Unsupported bulk action.' };
}
