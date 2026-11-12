import 'server-only';

import { z } from 'zod/v3';
import type { Prisma, TeamRole } from '@prisma/client';

import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { roleLabel, type AppRole } from '@/lib/authorization';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { runSerializableTransaction } from '@/lib/db-utils';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { getAccessControlSettings } from '@/lib/access/settings';
import {
  GRANT_DURATIONS_MINUTES,
  createRoleGrant,
  createTeamGrant,
  formatDuration,
} from '@/lib/access/grants';
import { setTeamMembership } from '@/lib/teams/administration';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';

const PENDING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_OPEN_REQUESTS = 5;
const MAX_REQUESTS_PER_DAY = 10;
const MAX_NOTIFIED_APPROVERS = 25;

const durationSchema = z
  .number()
  .int()
  .refine(value => (GRANT_DURATIONS_MINUTES as readonly number[]).includes(value), {
    message: 'Choose one of the offered durations.',
  })
  .nullable();

export const accessRequestInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ORG_ROLE'),
      requestedRole: z.enum(['USER', 'AUDITOR', 'RESPONDER', 'ADMIN']),
      reason: z.string().trim().min(10).max(1000),
      durationMinutes: durationSchema,
      originPath: z.string().max(500).optional(),
      requiredCapability: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['TEAM_MEMBERSHIP', 'TEAM_ROLE']),
      teamId: z.string().min(1).max(64),
      requestedTeamRole: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
      reason: z.string().trim().min(10).max(1000),
      durationMinutes: durationSchema,
      originPath: z.string().max(500).optional(),
      requiredCapability: z.string().max(100).optional(),
    })
    .strict(),
]);

export type AccessRequestInput = z.input<typeof accessRequestInput>;

function invalid(userMessage: string) {
  return new AppError({ code: 'VALIDATION_FAILED', userMessage });
}

/** Only same-origin relative paths are kept, so the approval link can never redirect off-site. */
export function safeOriginPath(path: string | undefined | null): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  return path.slice(0, 500);
}

export function describeAccessRequest(request: {
  kind: string;
  requestedRole: string | null;
  requestedTeamRole: string | null;
  durationMinutes: number | null;
  team?: { name: string } | null;
}): string {
  const duration = request.durationMinutes
    ? ` for ${formatDuration(request.durationMinutes)}`
    : ' permanently';
  if (request.kind === 'ORG_ROLE') {
    return `${roleLabel(request.requestedRole as AppRole)} role${duration}`;
  }
  const teamName = request.team?.name ? `"${request.team.name}"` : 'a team';
  const teamRole = (request.requestedTeamRole ?? 'MEMBER').toLowerCase();
  return request.kind === 'TEAM_MEMBERSHIP'
    ? `Join ${teamName} as ${teamRole}${duration}`
    : `Become ${teamRole} of ${teamName}${duration}`;
}

/** Approvers for a request: team owners/admins for team requests (falling back to org admins). */
async function approverIdsFor(
  tx: Prisma.TransactionClient,
  request: { kind: string; teamId: string | null; requestedTeamRole: TeamRole | null },
  excludeUserId: string
): Promise<string[]> {
  if (request.kind !== 'ORG_ROLE' && request.teamId) {
    const roles: TeamRole[] =
      request.requestedTeamRole === 'OWNER' ? ['OWNER'] : ['OWNER', 'ADMIN'];
    const managers = await tx.teamMember.findMany({
      where: { teamId: request.teamId, role: { in: roles }, user: { status: 'ACTIVE' } },
      select: { userId: true },
      take: MAX_NOTIFIED_APPROVERS,
    });
    const ids = managers.map(manager => manager.userId).filter(id => id !== excludeUserId);
    if (ids.length > 0) return ids;
  }
  const admins = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', id: { not: excludeUserId } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: MAX_NOTIFIED_APPROVERS,
  });
  return admins.map(admin => admin.id);
}

export async function createAccessRequest(requesterId: string, input: AccessRequestInput) {
  const settings = await getAccessControlSettings(true);
  if (!settings.requestsEnabled) {
    throw new AppError({
      code: 'ACCESS_FEATURE_DISABLED',
      userMessage: 'Access requests are turned off. Contact an administrator directly.',
    });
  }
  const parsed = accessRequestInput.safeParse(input);
  if (!parsed.success) {
    throw invalid(parsed.error.issues[0]?.message ?? 'Check the request and try again.');
  }
  const body = parsed.data;

  const created = await runSerializableTransaction(async tx => {
    const requester = await tx.user.findUnique({
      where: { id: requesterId },
      select: { id: true, name: true, email: true, role: true, roleSource: true, status: true },
    });
    if (!requester || requester.status !== 'ACTIVE')
      throw new AppError({ code: 'AUTHORIZATION_DENIED' });

    let teamName: string | null = null;
    if (body.kind === 'ORG_ROLE') {
      if (requester.roleSource !== 'MANUAL') {
        throw new AppError({
          code: 'ACCESS_FEATURE_DISABLED',
          userMessage:
            'Your role is managed by your identity provider. Ask your IT team to change your group membership.',
        });
      }
      if (requester.role === body.requestedRole && body.durationMinutes === null) {
        throw invalid(`You already have the ${roleLabel(body.requestedRole)} role.`);
      }
    } else {
      const team = await tx.team.findUnique({
        where: { id: body.teamId },
        select: {
          id: true,
          name: true,
          members: { where: { userId: requesterId }, select: { role: true } },
        },
      });
      if (!team) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Team not found.' });
      teamName = team.name;
      const current = team.members[0]?.role ?? null;
      if (body.kind === 'TEAM_MEMBERSHIP' && current) {
        throw invalid(`You are already a member of ${team.name}.`);
      }
      if (body.kind === 'TEAM_ROLE' && !current) {
        throw invalid(`Join ${team.name} before asking for a different team role.`);
      }
      if (current === body.requestedTeamRole) {
        throw invalid(`You are already ${current.toLowerCase()} of ${team.name}.`);
      }
    }

    const [open, today, duplicate] = await Promise.all([
      tx.accessRequest.count({ where: { requesterId, status: 'PENDING' } }),
      tx.accessRequest.count({
        where: { requesterId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      tx.accessRequest.findFirst({
        where: {
          requesterId,
          status: 'PENDING',
          kind: body.kind,
          ...(body.kind === 'ORG_ROLE'
            ? { requestedRole: body.requestedRole }
            : { teamId: body.teamId }),
        },
        select: { id: true },
      }),
    ]);
    if (duplicate) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage:
          'You already have an open request for this. You will be notified when it is reviewed.',
        details: { requestId: duplicate.id },
      });
    }
    if (open >= MAX_OPEN_REQUESTS || today >= MAX_REQUESTS_PER_DAY) {
      throw new AppError({ code: 'ACCESS_REQUEST_LIMITED' });
    }

    const request = await tx.accessRequest.create({
      data: {
        requesterId,
        kind: body.kind,
        requestedRole: body.kind === 'ORG_ROLE' ? body.requestedRole : null,
        teamId: body.kind === 'ORG_ROLE' ? null : body.teamId,
        requestedTeamRole: body.kind === 'ORG_ROLE' ? null : body.requestedTeamRole,
        reason: body.reason,
        durationMinutes: body.durationMinutes,
        originPath: safeOriginPath(body.originPath),
        requiredCapability: body.requiredCapability ?? null,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    await logAudit(
      {
        action: 'access.request.created',
        entityType: 'ACCESS_REQUEST',
        entityId: request.id,
        actorId: requesterId,
        details: {
          kind: request.kind,
          requestedRole: request.requestedRole,
          teamId: request.teamId,
          requestedTeamRole: request.requestedTeamRole,
          durationMinutes: request.durationMinutes,
          originPath: request.originPath,
        },
      },
      tx
    );
    const who = requester.name ? `${requester.name} (${requester.email})` : requester.email;
    const what = describeAccessRequest({ ...request, team: teamName ? { name: teamName } : null });
    await createInAppNotifications(
      {
        userIds: await approverIdsFor(tx, request, requesterId),
        type: 'SECURITY',
        title: 'Access request',
        message: `${who} asked for: ${what}. Reason: ${request.reason}`,
        entityType: 'ACCESS_REQUEST',
        entityId: request.id,
        dedupeKey: `access-request:${request.id}`,
      },
      tx
    );
    return request;
  });
  return created;
}

export async function cancelAccessRequest(requesterId: string, requestId: string) {
  const result = await prisma.accessRequest.updateMany({
    where: { id: requestId, requesterId, status: 'PENDING' },
    data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: requesterId },
  });
  if (result.count === 0) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'That request is no longer open.',
    });
  }
  await logAudit({
    action: 'access.request.cancelled',
    entityType: 'ACCESS_REQUEST',
    entityId: requestId,
    actorId: requesterId,
  });
}

export type ApproverContext = {
  id: string;
  /** Holds organization administration (base role or active grant). */
  isOrgAdmin: boolean;
  /** Signed in recently enough for sensitive changes. */
  recentlyAuthenticated: boolean;
};

/** Whether `approver` may decide `request`, and why not. Pure apart from the team lookup. */
export async function approverCanDecide(
  client: Prisma.TransactionClient | typeof prisma,
  approver: ApproverContext,
  request: {
    requesterId: string;
    kind: string;
    teamId: string | null;
    requestedTeamRole: TeamRole | null;
  },
  selfApprovalAllowed: boolean
): Promise<
  | { allowed: true }
  | { allowed: false; code: 'SEPARATION_OF_DUTIES' | 'AUTHORIZATION_DENIED'; message: string }
> {
  if (approver.id === request.requesterId && !selfApprovalAllowed) {
    return {
      allowed: false,
      code: 'SEPARATION_OF_DUTIES',
      message: 'You cannot approve your own request. Someone else must review it.',
    };
  }
  if (approver.isOrgAdmin) return { allowed: true };
  if (request.kind === 'ORG_ROLE' || !request.teamId) {
    return {
      allowed: false,
      code: 'AUTHORIZATION_DENIED',
      message: 'Only administrators can approve role changes.',
    };
  }
  const membership = await client.teamMember.findUnique({
    where: { userId_teamId: { userId: approver.id, teamId: request.teamId } },
    select: { role: true },
  });
  if (membership?.role === 'OWNER') return { allowed: true };
  if (membership?.role === 'ADMIN' && request.requestedTeamRole !== 'OWNER')
    return { allowed: true };
  return {
    allowed: false,
    code: 'AUTHORIZATION_DENIED',
    message:
      membership?.role === 'ADMIN'
        ? 'Only a team owner can approve becoming an owner.'
        : 'Only owners and admins of this team can approve this request.',
  };
}

export async function decideAccessRequest(
  approver: ApproverContext,
  requestId: string,
  decision: { approve: boolean; note?: string; durationMinutes?: number | null }
) {
  const settings = await getAccessControlSettings(true);
  const note = decision.note?.trim().slice(0, 1000) || null;
  const result = await runSerializableTransaction(async tx => {
    const request = await tx.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, role: true, roleSource: true, status: true } },
      },
    });
    if (!request || request.status !== 'PENDING') {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'This request was already decided.',
      });
    }
    if (request.expiresAt <= new Date()) {
      await tx.accessRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'This request has expired.' });
    }
    const permitted = await approverCanDecide(tx, approver, request, settings.selfApprovalAllowed);
    if (!permitted.allowed) {
      throw new AppError({ code: permitted.code, userMessage: permitted.message });
    }
    const team = request.teamId
      ? await tx.team.findUnique({ where: { id: request.teamId }, select: { name: true } })
      : null;

    let grantId: string | null = null;
    const durationMinutes =
      decision.durationMinutes === undefined ? request.durationMinutes : decision.durationMinutes;
    if (
      durationMinutes !== null &&
      !(GRANT_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes)
    ) {
      throw invalid('Choose one of the offered durations.');
    }

    if (decision.approve) {
      if (request.requester.status !== 'ACTIVE') {
        throw new AppError({
          code: 'RESOURCE_CONFLICT',
          userMessage: 'The requester is no longer active.',
        });
      }
      if (request.kind === 'ORG_ROLE') {
        const requestedRole = request.requestedRole as AppRole;
        if (requestedRole === 'ADMIN' && !approver.recentlyAuthenticated) {
          throw new AppError({
            code: 'STEP_UP_REQUIRED',
            userMessage: 'For your security, sign in again before granting Admin access.',
          });
        }
        if (durationMinutes === null) {
          if (request.requester.roleSource !== 'MANUAL') {
            throw new AppError({
              code: 'ACCESS_FEATURE_DISABLED',
              userMessage: 'This person’s role is managed by the identity provider.',
            });
          }
          // Shared security path: enforces the last-administrator invariant and MCP sign-out.
          await updateUserSecurityState(
            request.requesterId,
            { role: requestedRole, tokenVersion: { increment: 1 } },
            {},
            undefined,
            undefined,
            undefined,
            tx
          );
          await logAudit(
            {
              action: 'user.role.updated',
              entityType: 'USER',
              entityId: request.requesterId,
              actorId: approver.id,
              oldValue: { role: request.requester.role },
              newValue: { role: requestedRole },
              details: { viaAccessRequest: request.id },
            },
            tx
          );
        } else {
          const grant = await createRoleGrant(tx, {
            userId: request.requesterId,
            role: requestedRole,
            minutes: durationMinutes,
            reason: request.reason,
            grantedById: approver.id,
            source: 'REQUEST',
          });
          grantId = grant.id;
        }
      } else if (request.teamId && request.requestedTeamRole) {
        const previous = await tx.teamMember.findUnique({
          where: { userId_teamId: { userId: request.requesterId, teamId: request.teamId } },
          select: { role: true },
        });
        // Re-authorizes the approver against the team inside this transaction.
        await setTeamMembership(
          request.teamId,
          request.requesterId,
          { role: request.requestedTeamRole },
          { id: approver.id },
          { client: tx }
        );
        if (durationMinutes !== null) {
          const grant = await createTeamGrant(tx, {
            userId: request.requesterId,
            teamId: request.teamId,
            teamRole: request.requestedTeamRole,
            previousTeamRole: previous?.role ?? null,
            minutes: durationMinutes,
            reason: request.reason,
            grantedById: approver.id,
          });
          grantId = grant.id;
        }
      }
    }

    const updated = await tx.accessRequest.update({
      where: { id: request.id },
      data: {
        status: decision.approve ? 'APPROVED' : 'DENIED',
        decidedById: approver.id,
        decidedAt: new Date(),
        decisionNote: note,
        durationMinutes,
        grantId,
      },
    });
    await logAudit(
      {
        action: decision.approve ? 'access.request.approved' : 'access.request.denied',
        entityType: 'ACCESS_REQUEST',
        entityId: request.id,
        actorId: approver.id,
        details: {
          requesterId: request.requesterId,
          kind: request.kind,
          requestedRole: request.requestedRole,
          teamId: request.teamId,
          requestedTeamRole: request.requestedTeamRole,
          durationMinutes,
          grantId,
          note,
          selfApproved: approver.id === request.requesterId,
        },
      },
      tx
    );
    const what = describeAccessRequest({ ...updated, team });
    await createInAppNotifications(
      {
        userIds: [request.requesterId],
        type: 'SECURITY',
        title: decision.approve ? 'Access request approved' : 'Access request declined',
        message: decision.approve
          ? `Your request was approved: ${what}.${request.originPath ? ` Open ${request.originPath} to continue.` : ''}`
          : `Your request was declined: ${what}.${note ? ` Note: ${note}` : ''}`,
        entityType: 'ACCESS_REQUEST',
        entityId: request.id,
        dedupeKey: `access-request-decided:${request.id}`,
      },
      tx
    );
    return { request: updated, userId: request.requesterId };
  });
  invalidateSessionSecurityProjection(result.userId);
  return result.request;
}

/** Requests the person may decide. Admins see everything; team managers see their teams. */
export async function listDecidableAccessRequests(approver: { id: string; isOrgAdmin: boolean }) {
  const where: Prisma.AccessRequestWhereInput = approver.isOrgAdmin
    ? { status: 'PENDING' }
    : {
        status: 'PENDING',
        kind: { in: ['TEAM_MEMBERSHIP', 'TEAM_ROLE'] },
        teamId: {
          in: (
            await prisma.teamMember.findMany({
              where: { userId: approver.id, role: { in: ['OWNER', 'ADMIN'] } },
              select: { teamId: true },
            })
          ).map(membership => membership.teamId),
        },
      };
  const requests = await prisma.accessRequest.findMany({
    where: { ...where, expiresAt: { gt: new Date() } },
    include: { requester: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const teamIds = [...new Set(requests.map(request => request.teamId).filter(Boolean))] as string[];
  const teams = teamIds.length
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      })
    : [];
  const teamNames = new Map(teams.map(team => [team.id, team.name]));
  return requests.map(request => ({
    ...request,
    team: request.teamId
      ? { id: request.teamId, name: teamNames.get(request.teamId) ?? 'Unknown team' }
      : null,
  }));
}

export async function listMyAccessRequests(requesterId: string) {
  const requests = await prisma.accessRequest.findMany({
    where: { requesterId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const teamIds = [...new Set(requests.map(request => request.teamId).filter(Boolean))] as string[];
  const teams = teamIds.length
    ? await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      })
    : [];
  const teamNames = new Map(teams.map(team => [team.id, team.name]));
  return requests.map(request => ({
    ...request,
    team: request.teamId
      ? { id: request.teamId, name: teamNames.get(request.teamId) ?? 'Unknown team' }
      : null,
  }));
}

export async function expireStaleAccessRequests(now: Date = new Date()) {
  const result = await prisma.accessRequest.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return { expired: result.count };
}
