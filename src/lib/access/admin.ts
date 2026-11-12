import 'server-only';

import { z } from 'zod/v3';
import type { Prisma, Role } from '@prisma/client';

import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
  CAPABILITIES,
  NON_DELEGABLE_CAPABILITIES,
  getRoleCapabilities,
  isCapability,
  roleLabel,
  type AppRole,
  type Capability,
} from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  incidentOperatorRelation,
  type AuthorizationAction,
} from '@/lib/authorization-policy';
import { resolveUserActor } from '@/lib/authorization-actors';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import { resolvePageAccess, ruleAllows } from '@/lib/access/pages';
import { capabilityInfo, describeRequirement } from '@/lib/access/catalog';
import { invalidateAccessControlSettings } from '@/lib/access/settings';
import { invalidateSessionSecurityProjection } from '@/lib/session-security-projection';
import { runSerializableTransaction } from '@/lib/db-utils';
import { advanceUserSessionVersions, updateUserSecurityState } from '@/lib/users/admin-invariants';
import { LastAdministratorError } from '@/lib/users/last-administrator-error';

// ─── Access checker ─────────────────────────────────────────────────────────

export type AccessCheckStep = { label: string; outcome: 'pass' | 'fail' | 'info'; detail: string };
export type AccessCheckResult = {
  allowed: boolean;
  summary: string;
  steps: AccessCheckStep[];
};

const INCIDENT_ACTIONS: Record<string, AuthorizationAction> = {
  view: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  acknowledge: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
  note: AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
  escalate: AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
  resolve: AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE,
  manage: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
};

export const accessCheckInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('page'),
    userId: z.string().min(1),
    path: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal('capability'),
    userId: z.string().min(1),
    capability: z.string().refine(isCapability, 'Unknown permission'),
  }),
  z.object({
    kind: z.literal('incident'),
    userId: z.string().min(1),
    incidentId: z.string().min(1),
    action: z.enum(['view', 'acknowledge', 'note', 'escalate', 'resolve', 'manage']),
  }),
]);

/**
 * Explains, step by step, whether a person can do something and why. The admin equivalent of a
 * policy troubleshooter: it evaluates exactly the same engine that enforces access.
 */
export async function checkAccess(
  input: z.input<typeof accessCheckInput>
): Promise<AccessCheckResult> {
  const body = accessCheckInput.parse(input);
  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      customRole: { select: { name: true, archivedAt: true } },
      accessGrants: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        select: { role: true, incidentId: true, expiresAt: true, source: true },
      },
      teamMemberships: { select: { role: true, team: { select: { name: true } } } },
    },
  });
  if (!user) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
  const actor = await resolveUserActor(user.id);
  const steps: AccessCheckStep[] = [];
  steps.push({
    label: 'Account',
    outcome: user.status === 'ACTIVE' ? 'pass' : 'fail',
    detail: `${user.name ?? user.email} is ${user.status.toLowerCase()}.`,
  });
  steps.push({
    label: 'Role',
    outcome: 'info',
    detail: `${roleLabel(user.role as AppRole)}${
      user.customRole && !user.customRole.archivedAt
        ? ` + custom role “${user.customRole.name}”`
        : ''
    }.`,
  });
  if (user.accessGrants.length > 0) {
    steps.push({
      label: 'Temporary access',
      outcome: 'info',
      detail: user.accessGrants
        .map(
          grant =>
            `${grant.role ? roleLabel(grant.role as AppRole) : 'Team access'}${
              grant.incidentId ? ' (one incident)' : ''
            } until ${grant.expiresAt.toISOString()} via ${grant.source.toLowerCase().replace('_', '-')}`
        )
        .join('; '),
    });
  }
  steps.push({
    label: 'Teams',
    outcome: 'info',
    detail:
      user.teamMemberships.length > 0
        ? user.teamMemberships
            .map(member => `${member.team.name} (${member.role.toLowerCase()})`)
            .join(', ')
        : 'Not a member of any team.',
  });
  if (!actor || user.status !== 'ACTIVE') {
    return { allowed: false, summary: 'Inactive accounts have no access.', steps };
  }
  const caps = actor.capabilities ?? new Set(getRoleCapabilities(actor.role));

  if (body.kind === 'capability') {
    const allowed = caps.has(body.capability as Capability);
    const requirement = describeRequirement(body.capability as Capability);
    steps.push({
      label: 'Permission',
      outcome: allowed ? 'pass' : 'fail',
      detail: `${capabilityInfo(body.capability as Capability).label}: ${requirement.summary}.`,
    });
    return {
      allowed,
      summary: allowed ? 'Allowed.' : `Denied. ${requirement.summary}.`,
      steps,
    };
  }

  if (body.kind === 'page') {
    const rule = resolvePageAccess(body.path);
    const allowed = ruleAllows(rule, caps);
    steps.push({
      label: `Page rule: ${rule?.label ?? 'none'}`,
      outcome: allowed ? 'pass' : 'fail',
      detail: rule?.anyOf?.length
        ? `${describeRequirement(rule.anyOf).summary}.`
        : 'Available to everyone who is signed in.',
    });
    if (allowed && rule?.resource) {
      steps.push({
        label: 'Item-level check',
        outcome: 'info',
        detail: `The page also checks access to the specific ${rule.resource}; use the incident check for incidents.`,
      });
    }
    return { allowed, summary: allowed ? 'Allowed.' : 'Denied by the page rule.', steps };
  }

  const action = INCIDENT_ACTIONS[body.action];
  const resource = await resolveIncidentResourceForActor(actor, body.incidentId);
  if (!resource) {
    steps.push({ label: 'Incident', outcome: 'fail', detail: 'Incident not found.' });
    return { allowed: false, summary: 'Incident not found.', steps };
  }
  const decision = authorize({ actor, action, resource });
  const relation = incidentOperatorRelation(actor, resource);
  steps.push({
    label: 'Relationship to incident',
    outcome: 'info',
    detail:
      relation === 'ASSIGNEE'
        ? 'Assigned to this incident.'
        : relation === 'ON_CALL'
          ? 'Paged by this incident’s escalation policy.'
          : relation === 'TEAM_MEMBER'
            ? 'Member of the owning team.'
            : resource.watcherIds?.includes(actor.id)
              ? 'Watching this incident (watchers can read, not operate).'
              : 'No relationship (not assignee, on call, team member or watcher).',
  });
  steps.push({
    label: `Action: ${body.action}`,
    outcome: decision.allowed ? 'pass' : 'fail',
    detail: decision.allowed
      ? decision.scope === 'global'
        ? 'Allowed by organization-wide permission.'
        : 'Allowed by their relationship to this incident.'
      : decision.reason === 'MISSING_CAPABILITY'
        ? `${describeRequirement(decision.requiredCapability).summary}.`
        : decision.reason === 'RESOURCE_OUT_OF_SCOPE'
          ? 'They have the permission only for their own incidents, and this is not one of them.'
          : decision.reason,
  });
  return {
    allowed: decision.allowed,
    summary: decision.allowed ? 'Allowed.' : 'Denied.',
    steps,
  };
}

// ─── Who has access ─────────────────────────────────────────────────────────

export async function whoHasCapability(capability: Capability) {
  const roles = (['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as AppRole[]).filter(role =>
    getRoleCapabilities(role).includes(capability)
  );
  const now = new Date();
  const [byRole, byCustomRole, byGrant] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: roles as Role[] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        customRole: { capabilities: { has: capability }, archivedAt: null },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        customRole: { select: { name: true } },
      },
      take: 500,
    }),
    prisma.accessGrant.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
        incidentId: null,
        role: { in: roles as Role[] },
        user: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        expiresAt: true,
        role: true,
        source: true,
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      take: 500,
    }),
  ]);
  return { roles, byRole, byCustomRole, byGrant };
}

// ─── Custom roles ───────────────────────────────────────────────────────────

export const customRoleInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().nullable(),
  capabilities: z
    .array(z.string())
    .min(1, 'Choose at least one permission.')
    .max(80)
    .transform(list => [...new Set(list)])
    .refine(list => list.every(isCapability), 'Unknown permission.')
    .refine(
      list => list.every(capability => !NON_DELEGABLE_CAPABILITIES.has(capability as Capability)),
      'Organization administration cannot be granted through a custom role. Use the Admin role.'
    ),
});

export async function listCustomRoles() {
  return prisma.customRole.findMany({
    where: { archivedAt: null },
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function saveCustomRole(
  actorId: string,
  input: z.input<typeof customRoleInput> & { id?: string | null }
) {
  const body = customRoleInput.parse(input);
  try {
    const saved = await prisma.$transaction(async tx => {
      const before = input.id ? await tx.customRole.findUnique({ where: { id: input.id } }) : null;
      if (input.id && (!before || before.archivedAt)) {
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom role not found.' });
      }
      const role = before
        ? await tx.customRole.update({
            where: { id: before.id },
            data: {
              name: body.name,
              description: body.description ?? null,
              capabilities: body.capabilities,
            },
          })
        : await tx.customRole.create({
            data: {
              name: body.name,
              description: body.description ?? null,
              capabilities: body.capabilities,
              createdById: actorId,
            },
          });
      if (before) {
        // Holders' sessions pick up the new permission set on their next request.
        const holders = await tx.user.findMany({
          where: { customRoleId: role.id },
          select: { id: true },
        });
        await advanceUserSessionVersions(
          tx,
          holders.map(holder => holder.id)
        );
      }
      await logAudit(
        {
          action: before ? 'custom_role.updated' : 'custom_role.created',
          entityType: 'CUSTOM_ROLE',
          entityId: role.id,
          actorId,
          oldValue: before ? { name: before.name, capabilities: before.capabilities } : null,
          newValue: { name: role.name, capabilities: role.capabilities },
        },
        tx
      );
      return role;
    });
    return saved;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'A custom role with that name already exists.',
      });
    }
    throw error;
  }
}

export async function archiveCustomRole(actorId: string, id: string) {
  await prisma.$transaction(async tx => {
    const role = await tx.customRole.findUnique({ where: { id } });
    if (!role || role.archivedAt) {
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom role not found.' });
    }
    const holders = await tx.user.findMany({ where: { customRoleId: id }, select: { id: true } });
    await tx.user.updateMany({ where: { customRoleId: id }, data: { customRoleId: null } });
    await advanceUserSessionVersions(
      tx,
      holders.map(holder => holder.id)
    );
    await tx.customRole.update({ where: { id }, data: { archivedAt: new Date() } });
    await logAudit(
      {
        action: 'custom_role.archived',
        entityType: 'CUSTOM_ROLE',
        entityId: id,
        actorId,
        details: { name: role.name, unassignedUsers: holders.length },
      },
      tx
    );
  });
}

export async function assignCustomRole(
  actorId: string,
  userId: string,
  customRoleId: string | null
) {
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, customRoleId: true, email: true },
    });
    if (!user) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
    if (customRoleId) {
      const role = await tx.customRole.findUnique({ where: { id: customRoleId } });
      if (!role || role.archivedAt) {
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom role not found.' });
      }
    }
    if (user.customRoleId === customRoleId) return user;
    await tx.user.update({ where: { id: userId }, data: { customRoleId } });
    await advanceUserSessionVersions(tx, [userId]);
    await logAudit(
      {
        action: 'user.custom_role.updated',
        entityType: 'USER',
        entityId: userId,
        actorId,
        oldValue: { customRoleId: user.customRoleId },
        newValue: { customRoleId },
        targetEmail: user.email,
      },
      tx
    );
    return user;
  });
  invalidateSessionSecurityProjection(userId);
  return result;
}

// ─── Access reviews ─────────────────────────────────────────────────────────

/**
 * Starts a certification campaign covering every privileged assignment: Admin, Responder and
 * Auditor roles, custom roles, and temporary access lasting longer than a day.
 */
export async function startAccessReview(
  actorId: string | null,
  input: { name: string; dueAt?: Date | null }
) {
  const name =
    input.name.trim().slice(0, 120) || `Access review ${new Date().toISOString().slice(0, 10)}`;
  const now = new Date();
  const [privileged, grants] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ role: { in: ['ADMIN', 'RESPONDER', 'AUDITOR'] } }, { customRoleId: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleSource: true,
        customRole: { select: { id: true, name: true, capabilities: true } },
      },
    }),
    prisma.accessGrant.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        userId: true,
        role: true,
        teamId: true,
        teamRole: true,
        expiresAt: true,
        reason: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);
  const items: Prisma.AccessReviewItemCreateWithoutReviewInput[] = [];
  for (const user of privileged) {
    if (user.role !== 'USER') {
      items.push({
        userId: user.id,
        subjectType: 'ORG_ROLE',
        subjectId: user.role,
        subjectLabel: `${user.name ?? user.email} · ${roleLabel(user.role as AppRole)}`,
        snapshot: {
          email: user.email,
          role: user.role,
          roleSource: user.roleSource,
        },
      });
    }
    if (user.customRole) {
      items.push({
        userId: user.id,
        subjectType: 'CUSTOM_ROLE',
        subjectId: user.customRole.id,
        subjectLabel: `${user.name ?? user.email} · ${user.customRole.name}`,
        snapshot: {
          email: user.email,
          customRole: user.customRole.name,
          capabilities: user.customRole.capabilities,
        },
      });
    }
  }
  for (const grant of grants) {
    items.push({
      userId: grant.userId,
      subjectType: 'ACCESS_GRANT',
      subjectId: grant.id,
      subjectLabel: `${grant.user.name ?? grant.user.email} · temporary ${
        grant.role ? roleLabel(grant.role as AppRole) : `${grant.teamRole?.toLowerCase()} of team`
      }`,
      snapshot: {
        email: grant.user.email,
        role: grant.role,
        teamId: grant.teamId,
        teamRole: grant.teamRole,
        expiresAt: grant.expiresAt.toISOString(),
        reason: grant.reason,
      },
    });
  }
  const review = await prisma.$transaction(async tx => {
    const created = await tx.accessReview.create({
      data: { name, dueAt: input.dueAt ?? null, createdById: actorId, items: { create: items } },
    });
    await tx.systemSettings.updateMany({
      where: { id: 'default' },
      data: { accessReviewLastStartedAt: now },
    });
    await logAudit(
      {
        action: 'access_review.started',
        entityType: 'ACCESS_REVIEW',
        entityId: created.id,
        actorId,
        details: { name, items: items.length },
      },
      tx
    );
    return created;
  });
  invalidateAccessControlSettings();
  return review;
}

export async function decideAccessReviewItem(
  reviewerId: string,
  itemId: string,
  decision: 'KEEP' | 'REVOKE',
  note?: string
) {
  const item = await prisma.accessReviewItem.findUnique({
    where: { id: itemId },
    include: { review: { select: { status: true } } },
  });
  if (!item || item.review.status !== 'OPEN') {
    throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'This review is closed.' });
  }
  if (item.userId === reviewerId) {
    throw new AppError({
      code: 'SEPARATION_OF_DUTIES',
      userMessage: 'You cannot certify your own access. Another reviewer must decide this item.',
    });
  }
  await prisma.accessReviewItem.update({
    where: { id: itemId },
    data: { decision, reviewerId, decidedAt: new Date(), note: note?.trim().slice(0, 500) || null },
  });
}

/** Applies every REVOKE decision and closes the review. Unreviewed items block completion. */
export async function completeAccessReview(actorId: string, reviewId: string) {
  const affected = new Set<string>();
  const result = await runSerializableTransaction(async tx => {
    const review = await tx.accessReview.findUnique({
      where: { id: reviewId },
      include: { items: true },
    });
    if (!review || review.status !== 'OPEN') {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'This review is already closed.',
      });
    }
    const pending = review.items.filter(item => item.decision === 'PENDING').length;
    if (pending > 0) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: `${pending} item${pending === 1 ? '' : 's'} still need a decision.`,
      });
    }
    let revoked = 0;
    for (const item of review.items.filter(entry => entry.decision === 'REVOKE')) {
      if (item.subjectType === 'ORG_ROLE') {
        const user = await tx.user.findUnique({
          where: { id: item.userId },
          select: { role: true, roleSource: true },
        });
        if (user && user.role === item.subjectId && user.roleSource === 'MANUAL') {
          try {
            await updateUserSecurityState(
              item.userId,
              { role: 'USER', tokenVersion: { increment: 1 } },
              {},
              undefined,
              undefined,
              undefined,
              tx
            );
          } catch (error) {
            // The last active administrator is kept; the evidence records it was not applied.
            if (error instanceof LastAdministratorError) continue;
            throw error;
          }
          affected.add(item.userId);
          revoked += 1;
        }
      } else if (item.subjectType === 'CUSTOM_ROLE') {
        const updated = await tx.user.updateMany({
          where: { id: item.userId, customRoleId: item.subjectId },
          data: { customRoleId: null },
        });
        if (updated.count) {
          await advanceUserSessionVersions(tx, [item.userId]);
          affected.add(item.userId);
        }
        revoked += updated.count;
      } else if (item.subjectType === 'ACCESS_GRANT' && item.subjectId) {
        const updated = await tx.accessGrant.updateMany({
          where: { id: item.subjectId, revokedAt: null },
          data: { revokedAt: new Date(), revokedById: actorId, revokeReason: 'Access review' },
        });
        if (updated.count) affected.add(item.userId);
        revoked += updated.count;
      }
      await tx.accessReviewItem.update({ where: { id: item.id }, data: { appliedAt: new Date() } });
    }
    await tx.accessReview.update({
      where: { id: reviewId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await logAudit(
      {
        action: 'access_review.completed',
        entityType: 'ACCESS_REVIEW',
        entityId: reviewId,
        actorId,
        details: {
          items: review.items.length,
          kept: review.items.filter(item => item.decision === 'KEEP').length,
          revoked,
        },
      },
      tx
    );
    return { revoked };
  });
  for (const userId of affected) invalidateSessionSecurityProjection(userId);
  return result;
}

/** Evidence package for auditors (SOC 2 CC6.2/CC6.3, ISO 27001 A.5.18). */
export async function exportAccessReview(reviewId: string) {
  const review = await prisma.accessReview.findUnique({
    where: { id: reviewId },
    include: { items: { orderBy: { subjectLabel: 'asc' } } },
  });
  if (!review) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Review not found.' });
  const reviewerIds = [
    ...new Set(review.items.map(item => item.reviewerId).filter(Boolean)),
  ] as string[];
  const reviewers = await prisma.user.findMany({
    where: { id: { in: reviewerIds } },
    select: { id: true, name: true, email: true },
  });
  const reviewerById = new Map(reviewers.map(reviewer => [reviewer.id, reviewer]));
  return {
    review: {
      id: review.id,
      name: review.name,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      dueAt: review.dueAt?.toISOString() ?? null,
      completedAt: review.completedAt?.toISOString() ?? null,
    },
    items: review.items.map(item => ({
      subject: item.subjectLabel,
      type: item.subjectType,
      decision: item.decision,
      reviewer: item.reviewerId
        ? (reviewerById.get(item.reviewerId)?.email ?? item.reviewerId)
        : null,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      appliedAt: item.appliedAt?.toISOString() ?? null,
      note: item.note,
      snapshot: item.snapshot,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** Starts a review automatically when the configured interval has elapsed. */
export async function maybeStartScheduledAccessReview(now: Date = new Date()) {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { accessReviewIntervalDays: true, accessReviewLastStartedAt: true },
  });
  if (!settings?.accessReviewIntervalDays) return { started: false };
  const last = settings.accessReviewLastStartedAt?.getTime() ?? 0;
  if (now.getTime() - last < settings.accessReviewIntervalDays * 24 * 60 * 60 * 1000) {
    return { started: false };
  }
  const open = await prisma.accessReview.count({ where: { status: 'OPEN' } });
  if (open > 0) return { started: false };
  await startAccessReview(null, {
    name: `Scheduled access review ${now.toISOString().slice(0, 10)}`,
    dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  });
  return { started: true };
}

// ─── Policy settings ────────────────────────────────────────────────────────

export const accessPolicyInput = z.object({
  userIncidentActionsEnabled: z.boolean(),
  requestsEnabled: z.boolean(),
  breakGlassEnabled: z.boolean(),
  breakGlassMaxMinutes: z.number().int().min(15).max(240),
  selfApprovalAllowed: z.boolean(),
  reviewIntervalDays: z.number().int().min(30).max(365).nullable(),
});

export async function updateAccessPolicy(
  actorId: string,
  input: z.input<typeof accessPolicyInput>
) {
  const body = accessPolicyInput.parse(input);
  const data = {
    accessUserIncidentActionsEnabled: body.userIncidentActionsEnabled,
    accessRequestsEnabled: body.requestsEnabled,
    accessBreakGlassEnabled: body.breakGlassEnabled,
    accessBreakGlassMaxMinutes: body.breakGlassMaxMinutes,
    accessSelfApprovalAllowed: body.selfApprovalAllowed,
    accessReviewIntervalDays: body.reviewIntervalDays,
  };
  await prisma.$transaction(async tx => {
    const before = await tx.systemSettings.findUnique({
      where: { id: 'default' },
      select: {
        accessUserIncidentActionsEnabled: true,
        accessRequestsEnabled: true,
        accessBreakGlassEnabled: true,
        accessBreakGlassMaxMinutes: true,
        accessSelfApprovalAllowed: true,
        accessReviewIntervalDays: true,
      },
    });
    await tx.systemSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    await logAudit(
      {
        action: 'access_policy.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'access-policy',
        actorId,
        oldValue: before ?? null,
        newValue: data,
      },
      tx
    );
  });
  invalidateAccessControlSettings();
}

// ─── Insights ───────────────────────────────────────────────────────────────

/** Most frequently denied pages/actions recently: a signal for misconfigured roles or teams. */
export async function accessDenialInsights(days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.auditLog.findMany({
    where: { action: 'access.denied', createdAt: { gte: since } },
    select: { actorId: true, details: true },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  const byPath = new Map<
    string,
    { count: number; people: Set<string>; capabilities: Set<string> }
  >();
  for (const row of rows) {
    const details = (row.details ?? {}) as { metadata?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    const metadata = (details.metadata ?? details) as Record<string, unknown>;
    const path = typeof metadata.path === 'string' ? metadata.path : 'unknown';
    const key = path.replace(/\/c[a-z0-9]{20,}/g, '/[id]');
    const entry = byPath.get(key) ?? { count: 0, people: new Set(), capabilities: new Set() };
    entry.count += 1;
    if (row.actorId) entry.people.add(row.actorId);
    for (const capability of (metadata.requiredCapabilities as string[] | undefined) ?? []) {
      entry.capabilities.add(capability);
    }
    byPath.set(key, entry);
  }
  return [...byPath.entries()]
    .map(([path, entry]) => ({
      path,
      count: entry.count,
      people: entry.people.size,
      capabilities: [...entry.capabilities],
    }))
    .sort((a, b) => b.people - a.people || b.count - a.count)
    .slice(0, 15);
}

export function isAccessAdmin(capabilities: readonly Capability[]) {
  return (
    capabilities.includes(CAPABILITIES.ADMIN_MANAGE) ||
    capabilities.includes(CAPABILITIES.ACCESS_REVIEW_MANAGE)
  );
}
