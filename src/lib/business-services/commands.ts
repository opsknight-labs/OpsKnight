import 'server-only';

import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { isActiveIncidentStatus } from '@/lib/incident-status';
import type { BusinessServiceHealth, ImpactSource } from './contract';
import {
  getHealthSnapshot,
  incidentImpactSources,
  invalidateBusinessServiceHealth,
} from './health';
import { wouldCreateSupportCycle } from './stats';

const id = z.string().trim().min(1).max(100);

export const BusinessServiceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().default(null),
    tier: z.string().trim().max(40).nullable().default(null),
    ownerTeamId: id.nullable().default(null),
    memberServiceIds: z.array(id).max(200).default([]),
    followerUserIds: z.array(id).max(500).default([]),
    // Optional without defaults: a form that does not know them must not reset them on update.
    criticality: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).nullable().optional(),
    impactMinUrgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
    impactMaxPriority: z
      .string()
      .trim()
      .regex(/^P[1-9]$/i)
      .transform(value => value.toUpperCase())
      .nullable()
      .optional(),
    /** Members that are shown but never escalate past degraded; a subset of memberServiceIds. */
    nonCriticalServiceIds: z.array(id).max(200).optional(),
    /** Business services this one depends on (they support it). Cycles are rejected. */
    dependsOnBusinessServiceIds: z.array(id).max(50).optional(),
  })
  .strict();

export type BusinessServiceInput = z.input<typeof BusinessServiceInputSchema>;

export const BUSINESS_SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  tier: true,
  criticality: true,
  impactMinUrgency: true,
  impactMaxPriority: true,
  ownerTeamId: true,
  createdAt: true,
  updatedAt: true,
  ownerTeam: { select: { id: true, name: true } },
  members: {
    orderBy: { createdAt: 'asc' },
    select: {
      critical: true,
      service: { select: { id: true, name: true, status: true, teamId: true } },
    },
  },
  supportedBy: {
    orderBy: { createdAt: 'asc' },
    select: { child: { select: { id: true, name: true } } },
  },
  followers: {
    orderBy: { createdAt: 'asc' },
    select: { user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.BusinessServiceSelect;

/** Business services the actor can see: all for org-wide readers, else their teams' or members'. */
export function businessServiceReadWhere(
  actor: AuthorizationActor
): Prisma.BusinessServiceWhereInput {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  if (!decision.allowed) {
    throw new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: 'Service access denied.' });
  }
  if (decision.scope === 'global') return {};
  const teams = [...actor.teamIds];
  return {
    OR: [
      { ownerTeamId: { in: teams } },
      { members: { some: { service: { teamId: { in: teams } } } } },
    ],
  };
}

/** The same rule as businessServiceReadWhere, for in-memory filtering of the health snapshot. */
export function businessServiceReadScope(
  actor: AuthorizationActor
): { global: true } | { global: false; teamIds: ReadonlySet<string> } {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  if (!decision.allowed) {
    throw new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: 'Service access denied.' });
  }
  return decision.scope === 'global' ? { global: true } : { global: false, teamIds: new Set(actor.teamIds) };
}

/**
 * Business services the actor may change: all for org-wide managers, else those their teams own
 * (or, when unowned, that contain one of their teams' services).
 */
export function businessServiceWriteWhere(
  actor: AuthorizationActor
): Prisma.BusinessServiceWhereInput {
  if (globalServiceScope(actor)) return {};
  const teams = [...actor.teamIds];
  return {
    AND: [
      businessServiceReadWhere(actor),
      {
        OR: [
          { ownerTeamId: { in: teams } },
          { ownerTeamId: null, members: { some: { service: { teamId: { in: teams } } } } },
        ],
      },
    ],
  };
}

function globalServiceScope(actor: AuthorizationActor) {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE });
  return decision.allowed && decision.scope === 'global';
}

export function assertCanManageBusinessServices(actor: AuthorizationActor, deleting = false) {
  const action = deleting
    ? AUTHORIZATION_ACTIONS.SERVICE_DELETE
    : AUTHORIZATION_ACTIONS.SERVICE_CREATE;
  if (!authorize({ actor, action }).allowed) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: deleting
        ? 'Only Admins can delete business services.'
        : 'Only Responders and Admins can manage business services.',
    });
  }
}

type ParsedInput = z.output<typeof BusinessServiceInputSchema>;

/**
 * Every reference must exist, and what the actor adds must be in their scope: new member
 * services they can read, an owner team of their own, business services they can see.
 * Members already on the business service may stay even when the actor cannot see them.
 */
async function assertReferencesExist(
  tx: Prisma.TransactionClient,
  input: ParsedInput,
  actor: AuthorizationActor,
  current?: { id: string; memberServiceIds: readonly string[]; ownerTeamId: string | null }
) {
  const existing = new Set(current?.memberServiceIds ?? []);
  const added = input.memberServiceIds.filter(serviceId => !existing.has(serviceId));
  const dependsOn = input.dependsOnBusinessServiceIds ?? [];
  const [services, visibleAdded, users, team, dependencies] = await Promise.all([
    input.memberServiceIds.length
      ? tx.service.count({ where: { id: { in: input.memberServiceIds } } })
      : 0,
    added.length
      ? tx.service.count({ where: { AND: [{ id: { in: added } }, serviceReadWhere(actor)] } })
      : 0,
    input.followerUserIds.length
      ? tx.user.count({ where: { id: { in: input.followerUserIds }, status: 'ACTIVE' } })
      : 0,
    input.ownerTeamId ? tx.team.findUnique({ where: { id: input.ownerTeamId } }) : null,
    dependsOn.length
      ? tx.businessService.count({
          where: { AND: [{ id: { in: dependsOn } }, businessServiceReadWhere(actor)] },
        })
      : 0,
  ]);
  if (services !== new Set(input.memberServiceIds).size || visibleAdded !== new Set(added).size)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'A member service was not found.' });
  if (users !== new Set(input.followerUserIds).size)
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'A follower is not an active user.',
    });
  if (input.ownerTeamId && !team)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Owner team not found.' });
  if (
    input.ownerTeamId &&
    input.ownerTeamId !== current?.ownerTeamId &&
    !globalServiceScope(actor) &&
    !actor.teamIds.includes(input.ownerTeamId)
  )
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You can only assign a team you belong to as owner.',
    });
  if (dependencies !== new Set(dependsOn).size)
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'A supporting business service was not found.',
    });
  const members = new Set(input.memberServiceIds);
  if ((input.nonCriticalServiceIds ?? []).some(serviceId => !members.has(serviceId)))
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Non-critical services must also be members.',
    });
}

/**
 * Status pages show a business service through the technical services they publish, so every
 * page that maps the business service also maps its members (hidden members stay hidden).
 */
async function syncStatusPageMembers(
  tx: Prisma.TransactionClient,
  businessServiceId: string,
  removedServiceIds: readonly string[] = []
) {
  const [pages, members] = await Promise.all([
    tx.statusPageBusinessService.findMany({
      where: { businessServiceId },
      select: { statusPageId: true },
    }),
    tx.businessServiceMember.findMany({
      where: { businessServiceId },
      select: { serviceId: true },
    }),
  ]);
  if (!pages.length) return;
  const pageIds = pages.map(page => page.statusPageId);
  if (members.length) {
    await tx.statusPageService.createMany({
      data: pageIds.flatMap(statusPageId =>
        members.map(member => ({ statusPageId, serviceId: member.serviceId }))
      ),
      skipDuplicates: true,
    });
  }
  if (!removedServiceIds.length) return;
  // A dropped member leaves each page unless another business service on that page still has it.
  const stillShown = await tx.statusPageBusinessService.findMany({
    where: {
      statusPageId: { in: pageIds },
      businessServiceId: { not: businessServiceId },
      businessService: { members: { some: { serviceId: { in: [...removedServiceIds] } } } },
    },
    select: {
      statusPageId: true,
      businessService: {
        select: {
          members: {
            where: { serviceId: { in: [...removedServiceIds] } },
            select: { serviceId: true },
          },
        },
      },
    },
  });
  const keep = new Set(
    stillShown.flatMap(row =>
      row.businessService.members.map(member => `${row.statusPageId}:${member.serviceId}`)
    )
  );
  for (const statusPageId of pageIds) {
    const remove = removedServiceIds.filter(serviceId => !keep.has(`${statusPageId}:${serviceId}`));
    if (remove.length)
      await tx.statusPageService.deleteMany({ where: { statusPageId, serviceId: { in: remove } } });
  }
}

async function replaceSupports(
  tx: Prisma.TransactionClient,
  businessServiceId: string,
  childIds: readonly string[]
) {
  // One writer at a time, so two concurrent edges cannot close a cycle between them.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('business-service-support', 0))`;
  await tx.businessServiceSupport.deleteMany({
    where: { parentId: businessServiceId, childId: { notIn: [...childIds] } },
  });
  const existing = new Set(
    (
      await tx.businessServiceSupport.findMany({
        where: { parentId: businessServiceId },
        select: { childId: true },
      })
    ).map(row => row.childId)
  );
  for (const childId of childIds) {
    if (existing.has(childId)) continue;
    if (await wouldCreateSupportCycle(businessServiceId, childId, tx)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'That dependency would make a business service depend on itself.',
      });
    }
    await tx.businessServiceSupport.create({ data: { parentId: businessServiceId, childId } });
  }
}

async function replaceChildren(
  tx: Prisma.TransactionClient,
  businessServiceId: string,
  input: ParsedInput,
  previousMemberIds: readonly string[] = []
) {
  await tx.businessServiceMember.deleteMany({
    where: { businessServiceId, serviceId: { notIn: input.memberServiceIds } },
  });
  await tx.businessServiceMember.createMany({
    data: input.memberServiceIds.map(serviceId => ({ businessServiceId, serviceId })),
    skipDuplicates: true,
  });
  if (input.nonCriticalServiceIds) {
    await tx.businessServiceMember.updateMany({
      where: { businessServiceId },
      data: { critical: true },
    });
    if (input.nonCriticalServiceIds.length)
      await tx.businessServiceMember.updateMany({
        where: { businessServiceId, serviceId: { in: input.nonCriticalServiceIds } },
        data: { critical: false },
      });
  }
  if (input.dependsOnBusinessServiceIds)
    await replaceSupports(tx, businessServiceId, input.dependsOnBusinessServiceIds);
  await tx.businessServiceFollower.deleteMany({
    where: { businessServiceId, userId: { notIn: input.followerUserIds } },
  });
  await tx.businessServiceFollower.createMany({
    data: input.followerUserIds.map(userId => ({ businessServiceId, userId })),
    skipDuplicates: true,
  });
  const members = new Set(input.memberServiceIds);
  await syncStatusPageMembers(
    tx,
    businessServiceId,
    previousMemberIds.filter(serviceId => !members.has(serviceId))
  );
}

function conflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'A business service with this name already exists.',
    });
  }
  throw error;
}

type CommandContext = { actor: AuthorizationActor; source?: AuditEventSource };

async function audit(
  tx: Prisma.TransactionClient,
  context: CommandContext,
  action: string,
  id: string,
  newValue?: Prisma.InputJsonObject
) {
  await emitAuditEvent(
    {
      action,
      source: context.source ?? 'UI',
      target: { type: 'BUSINESS_SERVICE', id },
      actor: { type: 'USER', id: context.actor.id },
      ...(newValue ? { newValue } : {}),
    },
    tx
  );
}

function columns(input: ParsedInput) {
  return {
    name: input.name,
    description: input.description,
    tier: input.tier,
    ownerTeamId: input.ownerTeamId,
    ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
    ...(input.impactMinUrgency !== undefined ? { impactMinUrgency: input.impactMinUrgency } : {}),
    ...(input.impactMaxPriority !== undefined ? { impactMaxPriority: input.impactMaxPriority } : {}),
  };
}

export async function createBusinessService(
  raw: BusinessServiceInput,
  context: CommandContext,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const input = BusinessServiceInputSchema.parse(raw);
  const run = async (tx: Prisma.TransactionClient) => {
    await assertReferencesExist(tx, input, context.actor);
    const created = await tx.businessService
      .create({ data: columns(input), select: { id: true } })
      .catch(conflict);
    await replaceChildren(tx, created.id, input);
    await audit(tx, context, 'business_service.created', created.id, {
      name: input.name,
      memberServiceIds: input.memberServiceIds,
    });
    return tx.businessService.findUniqueOrThrow({
      where: { id: created.id },
      select: BUSINESS_SERVICE_SELECT,
    });
  };
  const result = await (client ? run(client) : prisma.$transaction(run));
  invalidateBusinessServiceHealth();
  return result;
}

export async function updateBusinessService(
  id: string,
  raw: Partial<BusinessServiceInput>,
  context: CommandContext,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const run = async (tx: Prisma.TransactionClient) => {
    const current = await tx.businessService.findFirst({
      where: { AND: [{ id }, businessServiceWriteWhere(context.actor)] },
      select: BUSINESS_SERVICE_SELECT,
    });
    if (!current) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const currentMemberIds = current.members.map(member => member.service.id);
    const input = BusinessServiceInputSchema.parse({
      name: current.name,
      description: current.description,
      tier: current.tier,
      ownerTeamId: current.ownerTeamId,
      memberServiceIds: currentMemberIds,
      followerUserIds: current.followers.map(follower => follower.user.id),
      ...raw,
    });
    await assertReferencesExist(tx, input, context.actor, {
      id,
      memberServiceIds: currentMemberIds,
      ownerTeamId: current.ownerTeamId,
    });
    if (input.dependsOnBusinessServiceIds?.includes(id))
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'A business service cannot depend on itself.',
      });
    await tx.businessService.update({ where: { id }, data: columns(input) }).catch(conflict);
    await replaceChildren(tx, id, input, currentMemberIds);
    await audit(tx, context, 'business_service.updated', id, {
      name: input.name,
      memberServiceIds: input.memberServiceIds,
    });
    return tx.businessService.findUniqueOrThrow({ where: { id }, select: BUSINESS_SERVICE_SELECT });
  };
  const result = await (client ? run(client) : prisma.$transaction(run));
  invalidateBusinessServiceHealth();
  return result;
}

export async function deleteBusinessService(
  id: string,
  context: CommandContext,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor, true);
  const run = async (tx: Prisma.TransactionClient) => {
    // Pages showing it are marked dirty before the cascade removes their mapping rows.
    const removed = await tx.businessService.deleteMany({
      where: { AND: [{ id }, businessServiceWriteWhere(context.actor)] },
    });
    if (!removed.count) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await audit(tx, context, 'business_service.deleted', id);
    return { id, deleted: true as const };
  };
  const result = await (client ? run(client) : prisma.$transaction(run));
  invalidateBusinessServiceHealth();
  return result;
}

/** Any reader may follow or unfollow a business service for themselves. */
export async function setBusinessServiceFollow(
  businessServiceId: string,
  follow: boolean,
  context: CommandContext
) {
  const visible = await prisma.businessService.findFirst({
    where: { AND: [{ id: businessServiceId }, businessServiceReadWhere(context.actor)] },
    select: { id: true },
  });
  if (!visible) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const key = { businessServiceId_userId: { businessServiceId, userId: context.actor.id } };
  if (follow) {
    await prisma.businessServiceFollower.upsert({
      where: key,
      update: {},
      create: { businessServiceId, userId: context.actor.id },
    });
  } else {
    await prisma.businessServiceFollower.deleteMany({
      where: { businessServiceId, userId: context.actor.id },
    });
  }
  return { businessServiceId, following: follow };
}

export type IncidentBusinessServiceImpactView = {
  id: string;
  name: string;
  source: ImpactSource;
  /** A responder unmarked it; shown in the picker, never as a chip. */
  excluded: boolean;
  /** Still impacting now (open incident, open impact). */
  active: boolean;
};

/**
 * Business services an incident impacts, for the incident "Impacts" chips: recorded impact rows
 * plus what the engine computes right now (the outbox effect may not have written them yet),
 * filtered to business services the actor can see.
 */
export async function impactedBusinessServicesForIncident(
  actor: AuthorizationActor,
  incidentId: string
): Promise<IncidentBusinessServiceImpactView[]> {
  if (!authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ }).allowed) return [];
  const [incident, rows] = await Promise.all([
    prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        serviceId: true,
        urgency: true,
        priority: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.incidentBusinessServiceImpact.findMany({
      where: { incidentId },
      select: {
        incidentId: true,
        businessServiceId: true,
        source: true,
        excluded: true,
        createdById: true,
        endedAt: true,
      },
    }),
  ]);
  if (!incident) return [];
  const open = isActiveIncidentStatus(incident.status);
  const views = new Map<string, Omit<IncidentBusinessServiceImpactView, 'id' | 'name'>>(
    rows.map(row => [
      row.businessServiceId,
      { source: row.source, excluded: row.excluded, active: open && !row.excluded && !row.endedAt },
    ])
  );
  if (open) {
    const snapshot = await getHealthSnapshot();
    for (const [businessServiceId, source] of incidentImpactSources(
      { ...snapshot.inputs, impactRows: rows },
      incident
    )) {
      if (!views.has(businessServiceId))
        views.set(businessServiceId, { source, excluded: false, active: true });
    }
  }
  if (!views.size) return [];
  const visible = await prisma.businessService.findMany({
    where: { AND: [{ id: { in: [...views.keys()] } }, businessServiceReadWhere(actor)] },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return visible.map(service => ({ ...service, ...views.get(service.id)! }));
}

type BusinessServiceRow = Prisma.BusinessServiceGetPayload<{
  select: typeof BUSINESS_SERVICE_SELECT;
}>;

/**
 * Public API shape: follower names without emails, and engine health when given. Member
 * `status` is the technical service's own status, kept for compatibility; `health` is authoritative.
 */
export function businessServiceDto(row: BusinessServiceRow, health?: BusinessServiceHealth | null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    criticality: row.criticality,
    impactMinUrgency: row.impactMinUrgency,
    impactMaxPriority: row.impactMaxPriority,
    ownerTeam: row.ownerTeam,
    members: row.members.map(({ service, critical }) => ({
      id: service.id,
      name: service.name,
      status: service.status,
      critical,
    })),
    dependsOn: row.supportedBy.map(({ child }) => child),
    followers: row.followers.map(({ user }) => ({ id: user.id, name: user.name })),
    health: health ? healthDto(health) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function healthDto(health: BusinessServiceHealth) {
  return {
    status: health.status,
    since: health.since,
    reasons: health.reasons,
    openIncidentCount: health.openIncidentCount,
    memberCount: health.memberCount,
    impactedMemberCount: health.impactedMemberCount,
    computedAt: health.computedAt,
  };
}
