'use server';

import {
  issueUserInvitation,
  renewUserInvitation,
  prepareUserInvitation,
} from '@/lib/users/invitations';
import { readInvitationPolicy, readUserInvitation } from '@/lib/users/invitation-policy';
import { getControlActor, lockControlActor } from '@/lib/auth-control/actor';
import { administerUser } from '@/lib/users/administration';
import { setTeamMembership, teamMemberInput } from '@/lib/teams/administration';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { assertAdmin, assertAdminOrTeamOwner, assertNotSelf, getCurrentUser } from '@/lib/rbac';
import { isAppRole } from '@/lib/authorization';
import type { Prisma, Role } from '@prisma/client';
import { removeTeamMembership } from '@/lib/teams/membership-commands';
import {
  dependencySummary,
  discoverUserDependencies,
  type UserDependencyReport,
} from '@/lib/users/dependencies';
import { bulkUpdateUserSecurityState, updateUserSecurityState } from '@/lib/users/admin-invariants';

export async function assertUserIsNotSoleOwner(userId: string) {
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

export async function assertNotLastAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });

  // A mutation can only remove an active administrator from the active-admin set
  // when the target currently belongs to that set. Disabled/invited admins do not.
  if (user?.role !== 'ADMIN' || user.status !== 'ACTIVE') return;

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, email: true },
  });
  if (!user) throw new Error('User not found.');
  if (user.status !== 'DISABLED' && user.status !== 'INVITED') {
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
    prisma.userToken.deleteMany({
      where: {
        OR: [{ userId }, ...(user.email ? [{ identifier: user.email.toLowerCase() }] : [])],
      },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}

export type UserFormState = {
  error?: string | null;
  success?: boolean;
  ssoOnly?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
  emailQueued?: boolean;
  providerConfigured?: boolean;
  providerName?: string | null;
  recipientEmail?: string | null;
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
  try {
    const admin = await assertAdmin();
    const actor = await getControlActor();
    if (actor.kind !== 'admin' || actor.id !== admin.id)
      throw new Error('Ordinary administrator access required for user invitations.');
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    const role = formData.get('role');
    if (!isAppRole(role)) return { error: 'Select a valid user role.' };
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const { checkRateLimit } = await import('@/lib/password-reset');
    await checkRateLimit(
      email,
      headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown',
      'user.invited'
    );
    const [policy, prepared] = await Promise.all([
      prisma.$transaction(tx => readInvitationPolicy(tx, actor)),
      prepareUserInvitation(),
    ]);
    const result = await issueUserInvitation(
      {
        name,
        email,
        role,
        authenticationMode:
          policy.mode === 'SSO_REQUIRED' || formData.get('ssoOnly') === 'on' ? 'SSO' : 'PASSWORD',
        delivery: prepared.emailProviders.length ? 'EMAIL' : 'MANUAL',
        expectedPolicyVersion: policy.policyVersion,
        expectedOidcConfigVersion: policy.oidcConfigVersion,
      },
      actor,
      {
        prepared,
        allowManualDisclosure: true,
        beforeWrite: tx => lockControlActor(tx, actor, false),
      }
    );
    revalidatePath('/users');
    revalidatePath('/audit');
    return {
      success: true,
      ssoOnly: result.authenticationMode === 'SSO',
      inviteUrl: result.inviteUrl,
      emailSent: false,
      emailQueued: Boolean(result.notificationId),
      providerConfigured: Boolean(prepared.emailProviders.length),
      providerName: prepared.emailProviders[0] ?? null,
      recipientEmail: result.recipientEmail,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create user invitation.' };
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

  await administerUser(userId, { operation: 'set-role', role }, { id: currentUser.id });

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
  await setTeamMembership(
    teamId,
    userId,
    teamMemberInput.parse({ role: formData.get('role') || 'MEMBER' }),
    { id: currentUser.id }
  );

  revalidatePath('/users');
  revalidatePath('/teams');
  revalidatePath('/audit');
}

export async function removeUserFromTeam(memberId: string) {
  const currentUser = await assertAdmin();
  await removeTeamMembership(memberId, currentUser);

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
  await administerUser(userId, { operation: 'deactivate' }, { id: currentUser.id });

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
  try {
    await administerUser(userId, { operation: 'reactivate' }, { id: currentUser.id });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to reactivate user.' };
  }

  revalidatePath('/users');
  revalidatePath('/audit');
}

export async function generateInvite(
  userId: string,
  _prevState: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  try {
    const admin = await assertAdmin();
    const actor = await getControlActor();
    if (actor.kind !== 'admin' || actor.id !== admin.id)
      throw new Error('Ordinary administrator access required for user invitations.');
    const [snapshot, prepared] = await Promise.all([
      prisma.$transaction(
        async tx => ({
          policy: await readInvitationPolicy(tx, actor),
          invitation: await readUserInvitation(tx, userId, actor),
          user: await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
        }),
        { isolationLevel: 'Serializable' }
      ),
      prepareUserInvitation(),
    ]);
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const { checkRateLimit } = await import('@/lib/password-reset');
    await checkRateLimit(
      snapshot.user.email,
      headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || 'unknown',
      'user.invite.resent'
    );
    const result = await renewUserInvitation(
      userId,
      {
        authenticationMode:
          snapshot.policy.mode === 'SSO_REQUIRED' ||
          snapshot.invitation.linkingApprovalRevision ||
          formData.get('ssoOnly') === 'on'
            ? 'SSO'
            : 'PASSWORD',
        delivery: prepared.emailProviders.length ? 'EMAIL' : 'MANUAL',
        expectedPolicyVersion: snapshot.policy.policyVersion,
        expectedOidcConfigVersion: snapshot.policy.oidcConfigVersion,
        expectedLinkingApprovalRevision: snapshot.invitation.linkingApprovalRevision,
      },
      actor,
      {
        prepared,
        expectedRevision: snapshot.invitation.revision,
        allowManualDisclosure: true,
        beforeWrite: tx => lockControlActor(tx, actor, false),
      }
    );
    revalidatePath('/users');
    revalidatePath('/audit');
    return {
      success: true,
      ssoOnly: result.authenticationMode === 'SSO',
      inviteUrl: result.inviteUrl,
      emailSent: false,
      emailQueued: Boolean(result.notificationId),
      providerConfigured: Boolean(prepared.emailProviders.length),
      providerName: prepared.emailProviders[0] ?? null,
      recipientEmail: result.recipientEmail,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to renew user invitation.' };
  }
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
      select: { email: true, name: true, role: true, status: true },
    });

    await deleteUserInternal(userId);

    await logAudit({
      action: userToDelete?.status === 'INVITED' ? 'user.invitation.deleted' : 'user.deleted',
      entityType: 'USER',
      entityId: userId,
      actorId: currentUser?.id || null,
      targetEmail: userToDelete?.email,
      details: {
        email: userToDelete?.email,
        name: userToDelete?.name,
        role: userToDelete?.role,
        status: userToDelete?.status,
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
    await bulkUpdateUserSecurityState(
      userIds,
      {
        status: 'ACTIVE',
        tokenVersion: { increment: 1 },
      },
      {
        deactivatedAt: null,
      }
    );

    await logAudit({
      action: 'user.reactivated.bulk',
      entityType: 'USER',
      entityId: 'bulk',
      actorId: admin?.id || null,
      details: { userIds, count: userIds.length },
    });

    revalidatePath('/users');
    return { success: true, message: `Activated ${userIds.length} user(s)` };
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
      },
      async tx => {
        const revokedAt = new Date();
        await tx.userToken.updateMany({
          where: { userId: { in: userIds }, usedAt: null, revokedAt: null },
          data: { revokedAt },
        });
        await tx.apiKey.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt },
        });
        await tx.oidcLinkingApproval.updateMany({
          where: { userId: { in: userIds }, revokedAt: null },
          data: { revokedAt },
        });
        await tx.userDevice.deleteMany({ where: { userId: { in: userIds } } });
      }
    );

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

    await bulkUpdateUserSecurityState(
      userIds,
      { role, roleSource: 'MANUAL' },
      { tokenVersion: { increment: 1 } }
    );

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
    select: { email: true, role: true, phoneNumber: true },
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

  // Validate voice notifications if requested
  const voiceRequested = formData.has('voiceNotificationsEnabled')
    ? formData.get('voiceNotificationsEnabled') === 'true'
    : false;
  if (voiceRequested) {
    const effectivePhone = phoneNumber ? phoneNumber.trim() : existingUser.phoneNumber;
    if (!effectivePhone) {
      return {
        error: 'A valid phone number is required when Voice notifications are enabled.',
      };
    }
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(effectivePhone)) {
      return { error: 'Phone number must be in E.164 format (e.g., +1234567890)' };
    }
    const { getVoiceConfig } = await import('@/lib/notification-providers');
    const voiceConfig = await getVoiceConfig();
    if (!voiceConfig.enabled) {
      return {
        error: 'Voice notifications cannot be enabled because Twilio Voice is not configured.',
      };
    }
  }

  // Role validation
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
      ...(formData.has('voiceNotificationsEnabled')
        ? { voiceNotificationsEnabled: formData.get('voiceNotificationsEnabled') === 'true' }
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
      ? await updateUserSecurityState(
          userId,
          { role: targetRole, roleSource: 'MANUAL' },
          profileData,
          revokeInviteTokens
        )
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
