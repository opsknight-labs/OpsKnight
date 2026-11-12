import 'server-only';

import type { Prisma, Role, TeamRole } from '@prisma/client';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { roleLabel, type AppRole } from '@/lib/authorization';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { getAccessControlSettings } from '@/lib/access/settings';
import { advanceUserSessionVersions } from '@/lib/users/admin-invariants';

export const GRANT_DURATIONS_MINUTES = [60, 240, 480, 1440, 4320, 10080] as const;
export const BREAK_GLASS_DURATIONS_MINUTES = [15, 30, 60, 120, 240] as const;
const MAX_BREAK_GLASS_PER_DAY = 3;
const MAX_NOTIFIED_ADMINS = 25;

export function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

async function activeAdminIds(client: Prisma.TransactionClient | typeof prisma = prisma) {
  const admins = await client.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: MAX_NOTIFIED_ADMINS,
  });
  return admins.map(admin => admin.id);
}

/** Org-wide role elevation for a fixed window. */
export async function createRoleGrant(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    role: AppRole;
    minutes: number;
    reason: string;
    grantedById: string | null;
    source: 'REQUEST' | 'ADMIN' | 'BREAK_GLASS';
    incidentId?: string | null;
  }
) {
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  const grant = await tx.accessGrant.create({
    data: {
      userId: input.userId,
      role: input.role as Role,
      incidentId: input.incidentId ?? null,
      source: input.source,
      reason: input.reason,
      grantedById: input.grantedById,
      expiresAt,
    },
  });
  await logAudit(
    {
      action:
        input.source === 'BREAK_GLASS' ? 'access.break_glass.activated' : 'access.grant.created',
      entityType: 'ACCESS_GRANT',
      entityId: grant.id,
      actorId: input.grantedById ?? input.userId,
      details: {
        userId: input.userId,
        role: input.role,
        incidentId: input.incidentId ?? null,
        expiresAt: expiresAt.toISOString(),
        minutes: input.minutes,
        reason: input.reason,
        source: input.source,
      },
    },
    tx
  );
  return grant;
}

/** Temporary team membership or team-role change; reverted when the grant ends. */
export async function createTeamGrant(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    teamId: string;
    teamRole: TeamRole;
    previousTeamRole: TeamRole | null;
    minutes: number;
    reason: string;
    grantedById: string;
  }
) {
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  // Overlapping temporary grants on the same team share one "before" state, so whichever ends
  // last restores what the person had before any temporary access.
  const overlapping = await tx.accessGrant.findFirst({
    where: {
      userId: input.userId,
      teamId: input.teamId,
      revokedAt: null,
      endProcessedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'asc' },
    select: { previousTeamRole: true, createdMembership: true },
  });
  const previousTeamRole = overlapping ? overlapping.previousTeamRole : input.previousTeamRole;
  const createdMembership = overlapping
    ? overlapping.createdMembership
    : input.previousTeamRole === null;
  const grant = await tx.accessGrant.create({
    data: {
      userId: input.userId,
      teamId: input.teamId,
      teamRole: input.teamRole,
      previousTeamRole,
      createdMembership,
      source: 'REQUEST',
      reason: input.reason,
      grantedById: input.grantedById,
      expiresAt,
    },
  });
  await logAudit(
    {
      action: 'access.grant.created',
      entityType: 'ACCESS_GRANT',
      entityId: grant.id,
      actorId: input.grantedById,
      details: {
        userId: input.userId,
        teamId: input.teamId,
        teamRole: input.teamRole,
        previousTeamRole: input.previousTeamRole,
        expiresAt: expiresAt.toISOString(),
        reason: input.reason,
      },
    },
    tx
  );
  return grant;
}

export async function revokeAccessGrant(input: {
  grantId: string;
  actorId: string;
  reason: string;
  /** Self-revocation ("end my elevated access now") is always allowed. */
  allowSelf?: boolean;
  isAdmin: boolean;
}) {
  const grant = await prisma.accessGrant.findUnique({ where: { id: input.grantId } });
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'That access is no longer active.',
    });
  }
  const isSelf = grant.userId === input.actorId;
  if (!(input.isAdmin || (isSelf && input.allowSelf !== false))) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only an administrator can end someone else’s access.',
    });
  }
  await prisma.$transaction(async tx => {
    await tx.accessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(), revokedById: input.actorId, revokeReason: input.reason },
    });
    await logAudit(
      {
        action: 'access.grant.revoked',
        entityType: 'ACCESS_GRANT',
        entityId: grant.id,
        actorId: input.actorId,
        details: { userId: grant.userId, reason: input.reason, self: isSelf },
      },
      tx
    );
  });
  invalidateSessionSecurityProjection(grant.userId);
  // Revert team side effects immediately rather than waiting for the sweep.
  await processEndedAccessGrants(new Date(), grant.id);
}

/**
 * Break-glass: anyone may elevate themselves to Responder for a short window during an
 * emergency. Requires a reason and a recent sign-in, is limited per day, and immediately alerts
 * every administrator. Optionally scoped to a single incident.
 */
export async function activateBreakGlass(input: {
  userId: string;
  reason: string;
  minutes: number;
  incidentId?: string | null;
}) {
  const settings = await getAccessControlSettings(true);
  if (!settings.breakGlassEnabled) {
    throw new AppError({
      code: 'ACCESS_FEATURE_DISABLED',
      userMessage: 'Emergency access is turned off for your organization.',
    });
  }
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Describe the emergency in at least 10 characters.',
    });
  }
  const minutes = Math.min(Math.max(Math.round(input.minutes), 5), settings.breakGlassMaxMinutes);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'You already have Responder access; emergency access is not needed.',
    });
  }
  if (input.incidentId) {
    const incident = await prisma.incident.findUnique({
      where: { id: input.incidentId },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  }
  const recent = await prisma.accessGrant.count({
    where: { userId: input.userId, source: 'BREAK_GLASS', createdAt: { gte: since } },
  });
  if (recent >= MAX_BREAK_GLASS_PER_DAY) {
    throw new AppError({
      code: 'ACCESS_REQUEST_LIMITED',
      userMessage: 'You have used emergency access too often today. Ask an administrator.',
    });
  }
  const grant = await prisma.$transaction(async tx => {
    const created = await createRoleGrant(tx, {
      userId: input.userId,
      role: 'RESPONDER',
      minutes,
      reason,
      grantedById: input.userId,
      source: 'BREAK_GLASS',
      incidentId: input.incidentId ?? null,
    });
    const who = user.name ? `${user.name} (${user.email})` : user.email;
    await createInAppNotifications(
      {
        userIds: (await activeAdminIds(tx)).filter(id => id !== input.userId),
        type: 'SECURITY',
        title: 'Emergency access activated',
        message: `${who} activated emergency Responder access for ${formatDuration(minutes)}${
          input.incidentId ? ' on one incident' : ''
        }. Reason: ${reason}`,
        entityType: 'ACCESS_GRANT',
        entityId: created.id,
        dedupeKey: `break-glass:${created.id}`,
      },
      tx
    );
    return created;
  });
  invalidateSessionSecurityProjection(input.userId);
  return grant;
}

/**
 * Reverts side effects of grants that expired or were revoked, then notifies the holder.
 * Enforcement never depends on this sweep: every check compares `expiresAt` at request time.
 */
export async function processEndedAccessGrants(now: Date = new Date(), onlyGrantId?: string) {
  const ended = await prisma.accessGrant.findMany({
    where: {
      endProcessedAt: null,
      OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }],
      ...(onlyGrantId ? { id: onlyGrantId } : {}),
    },
    take: 200,
    orderBy: { expiresAt: 'asc' },
  });
  let processed = 0;
  for (const grant of ended) {
    try {
      await prisma.$transaction(async tx => {
        let revertNote: string | null = null;
        if (grant.teamId && grant.teamRole) {
          revertNote = await revertTeamGrant(tx, grant);
        }
        await tx.accessGrant.update({
          where: { id: grant.id },
          data: { endProcessedAt: now },
        });
        await logAudit(
          {
            action: grant.revokedAt ? 'access.grant.ended.revoked' : 'access.grant.ended.expired',
            entityType: 'ACCESS_GRANT',
            entityId: grant.id,
            details: {
              userId: grant.userId,
              role: grant.role,
              teamId: grant.teamId,
              teamRole: grant.teamRole,
              ...(revertNote ? { note: revertNote } : {}),
            },
          },
          tx
        );
        await createInAppNotifications(
          {
            userIds: [grant.userId],
            type: 'SECURITY',
            title: 'Temporary access ended',
            message: grant.role
              ? `Your temporary ${roleLabel(grant.role as AppRole)} access has ended.`
              : 'Your temporary team access has ended.',
            entityType: 'ACCESS_GRANT_ENDED',
            entityId: grant.id,
            dedupeKey: `access-grant-ended:${grant.id}`,
          },
          tx
        );
      });
      invalidateSessionSecurityProjection(grant.userId);
      processed += 1;
    } catch (error) {
      logger.warn('[Access] Could not finish ending an access grant', {
        grantId: grant.id,
        error,
      });
    }
  }
  return { processed };
}

async function revertTeamGrant(
  tx: Prisma.TransactionClient,
  grant: {
    id: string;
    userId: string;
    teamId: string | null;
    teamRole: TeamRole | null;
    previousTeamRole: TeamRole | null;
    createdMembership: boolean;
  }
): Promise<string | null> {
  if (!grant.teamId) return null;
  // Another temporary grant on this team is still active: it now owns the revert.
  const stillActive = await tx.accessGrant.findFirst({
    where: {
      userId: grant.userId,
      teamId: grant.teamId,
      id: { not: grant.id },
      revokedAt: null,
      endProcessedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, teamRole: true },
  });
  if (stillActive) {
    const member = await tx.teamMember.findUnique({
      where: { userId_teamId: { userId: grant.userId, teamId: grant.teamId } },
    });
    // Only step back from the ending grant's role; a later manual change wins.
    if (
      member &&
      stillActive.teamRole &&
      member.role === grant.teamRole &&
      member.role !== stillActive.teamRole
    ) {
      await advanceUserSessionVersions(tx, [grant.userId]);
      await tx.teamMember.update({
        where: { id: member.id },
        data: { role: stillActive.teamRole },
      });
    }
    return 'kept: another temporary grant on this team is still active';
  }
  const member = await tx.teamMember.findUnique({
    where: { userId_teamId: { userId: grant.userId, teamId: grant.teamId } },
  });
  // Someone changed the membership after the grant; their later decision wins.
  if (!member || member.role !== grant.teamRole) return 'membership changed since grant';
  if (member.role === 'OWNER') {
    const otherOwner = await tx.teamMember.findFirst({
      where: {
        teamId: grant.teamId,
        role: 'OWNER',
        id: { not: member.id },
        user: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!otherOwner) return 'kept: team would have no owner';
  }
  await advanceUserSessionVersions(tx, [grant.userId]);
  if (grant.createdMembership) {
    await tx.teamMember.delete({ where: { id: member.id } });
    await tx.team.updateMany({
      where: { id: grant.teamId, teamLeadId: grant.userId },
      data: { teamLeadId: null },
    });
  } else if (grant.previousTeamRole) {
    await tx.teamMember.update({
      where: { id: member.id },
      data: { role: grant.previousTeamRole },
    });
  }
  return null;
}
