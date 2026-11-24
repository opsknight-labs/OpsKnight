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
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import type { BusinessServiceHealth, ImpactSource } from './contract';
import { invalidateBusinessServiceHealth } from './health';
import { wouldCreateSupportCycle } from './stats';
import { CustomAttributesSchema } from './attributes';
import { BusinessServiceLinkSchema, parseBusinessServiceLinks } from './links';

const id = z.string().trim().min(1).max(100);

export const BusinessServiceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().default(null),
    // Legacy free text with no default: a client that omits it keeps the stored value on update.
    tier: z.string().trim().max(40).nullable().optional(),
    /** Plain-language summary shown on status pages in place of the description. */
    statusPageSummary: z.string().trim().max(500).nullable().optional(),
    links: z.array(BusinessServiceLinkSchema).max(10).nullable().optional(),
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
    /** Teams whose members hear about this business service; replaces the set when present. */
    teamSubscriberIds: z.array(id).max(200).optional(),
    // Catalog depth. Optional without defaults so a client that omits them keeps stored values.
    sloTarget: z.number().min(90).max(99.999).nullable().optional(),
    sloWindowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
    ownerUserId: id.nullable().optional(),
    escalationPolicyId: id.nullable().optional(),
    contactChannel: z.string().trim().max(200).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    environment: z.string().trim().max(40).nullable().optional(),
    lifecycle: z.enum(['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED']).optional(),
    lastReviewedAt: z.union([z.null(), z.coerce.date()]).optional(),
    customAttributes: CustomAttributesSchema.nullable().optional(),
    // Health inputs: quorum of critical members impacted, and the dependency walk depth.
    quorumPartialPct: z.number().int().min(1).max(100).nullable().optional(),
    quorumMajorPct: z.number().int().min(1).max(100).nullable().optional(),
    dependencyHopDepth: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export type BusinessServiceInput = z.input<typeof BusinessServiceInputSchema>;

export const BUSINESS_SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  tier: true,
  statusPageSummary: true,
  links: true,
  criticality: true,
  impactMinUrgency: true,
  impactMaxPriority: true,
  ownerTeamId: true,
  sloTarget: true,
  sloWindowDays: true,
  ownerUserId: true,
  escalationPolicyId: true,
  contactChannel: true,
  tags: true,
  environment: true,
  lifecycle: true,
  lastReviewedAt: true,
  customAttributes: true,
  quorumPartialPct: true,
  quorumMajorPct: true,
  dependencyHopDepth: true,
  createdAt: true,
  updatedAt: true,
  ownerTeam: { select: { id: true, name: true } },
  ownerUser: { select: { id: true, name: true, email: true } },
  escalationPolicy: { select: { id: true, name: true } },
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
  teamSubscribers: { select: { team: { select: { id: true, name: true } } } },
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
  return decision.scope === 'global'
    ? { global: true }
    : { global: false, teamIds: new Set(actor.teamIds) };
}

/**
 * Business services the actor may change: the manage permission (checked by the caller) applied
 * to what the actor can see, so a scoped manager never edits or deletes beyond their scope.
 */
export const businessServiceWriteWhere = businessServiceReadWhere;

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
  current?: {
    id: string;
    memberServiceIds: readonly string[];
    ownerTeamId: string | null;
    ownerUserId: string | null;
    escalationPolicyId: string | null;
  }
) {
  const existing = new Set(current?.memberServiceIds ?? []);
  const added = input.memberServiceIds.filter(serviceId => !existing.has(serviceId));
  const dependsOn = input.dependsOnBusinessServiceIds ?? [];
  if (
    input.quorumPartialPct != null &&
    input.quorumMajorPct != null &&
    input.quorumPartialPct > input.quorumMajorPct
  )
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'The partial quorum threshold cannot exceed the major one.',
    });
  const [services, visibleAdded, users, team, dependencies, owner, policy] = await Promise.all([
    input.memberServiceIds.length
      ? tx.service.count({ where: { id: { in: input.memberServiceIds } } })
      : 0,
    added.length
      ? tx.service.count({ where: { AND: [{ id: { in: added } }, serviceReadWhere(actor)] } })
      : 0,
    input.followerUserIds.length
      ? tx.user.count({ where: { id: { in: input.followerUserIds }, status: 'ACTIVE' } })
      : 0,
    input.ownerTeamId
      ? tx.team.findFirst({
          where: { AND: [{ id: input.ownerTeamId }, teamReadWhere(actor)] },
          select: { id: true },
        })
      : null,
    dependsOn.length
      ? tx.businessService.count({
          where: { AND: [{ id: { in: dependsOn } }, businessServiceReadWhere(actor)] },
        })
      : 0,
    input.ownerUserId ? tx.user.count({ where: { id: input.ownerUserId, status: 'ACTIVE' } }) : 1,
    input.escalationPolicyId
      ? tx.escalationPolicy.count({ where: { id: input.escalationPolicyId, archivedAt: null } })
      : 1,
  ]);
  // An unchanged owner or policy may stay even if it has since been disabled or archived.
  if (
    (!owner && input.ownerUserId !== current?.ownerUserId) ||
    (!policy && input.escalationPolicyId !== current?.escalationPolicyId)
  )
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'Owner or escalation policy not found.',
    });
  if (services !== new Set(input.memberServiceIds).size || visibleAdded !== new Set(added).size)
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'A member service was not found.',
    });
  if (users !== new Set(input.followerUserIds).size)
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'A follower is not an active user.',
    });
  // An unchanged owner may stay even when the actor cannot see that team.
  if (input.ownerTeamId && !team && input.ownerTeamId !== current?.ownerTeamId)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Owner team not found.' });
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
        members.map(member => ({
          statusPageId,
          serviceId: member.serviceId,
          viaBusinessService: true,
        }))
      ),
      // A service the admin already selected directly keeps its row and stays direct.
      skipDuplicates: true,
    });
  }
  if (!removedServiceIds.length) return;
  // A dropped member leaves each page it was published on only through business services,
  // unless another business service on that page still has it; direct selections stay.
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
      await tx.statusPageService.deleteMany({
        where: { statusPageId, serviceId: { in: remove }, viaBusinessService: true },
      });
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
  if (input.teamSubscriberIds) {
    const teamIds = [...new Set(input.teamSubscriberIds)];
    if ((await tx.team.count({ where: { id: { in: teamIds } } })) !== teamIds.length)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Subscriber team not found.' });
    await tx.businessServiceTeamSubscriber.deleteMany({
      where: { businessServiceId, teamId: { notIn: teamIds } },
    });
    await tx.businessServiceTeamSubscriber.createMany({
      data: teamIds.map(teamId => ({ businessServiceId, teamId })),
      skipDuplicates: true,
    });
  }
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

/**
 * Business-service writes have no database trigger on the realtime clock (only Incident, Service
 * and a few rename tables do). Appending a tick in the same transaction makes every instance's
 * health cache, keyed by that generation, recompute instead of waiting for its TTL.
 */
async function bumpRealtimeClock(tx: Prisma.TransactionClient) {
  await tx.realtimeChange.create({ data: {} });
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

/** Only the keys the caller sent, so an omitted field keeps its stored value on update. */
function pick<K extends keyof ParsedInput>(input: ParsedInput, keys: readonly K[]) {
  return Object.fromEntries(
    keys.filter(key => input[key] !== undefined).map(key => [key, input[key]])
  );
}

function columns(input: ParsedInput) {
  return {
    name: input.name,
    description: input.description,
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
    ownerTeamId: input.ownerTeamId,
    ...(input.statusPageSummary !== undefined
      ? { statusPageSummary: input.statusPageSummary }
      : {}),
    ...(input.links !== undefined ? { links: input.links ?? Prisma.DbNull } : {}),
    ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
    ...pick(input, [
      'sloTarget',
      'sloWindowDays',
      'ownerUserId',
      'escalationPolicyId',
      'contactChannel',
      'tags',
      'environment',
      'lifecycle',
      'lastReviewedAt',
      'quorumPartialPct',
      'quorumMajorPct',
      'dependencyHopDepth',
    ]),
    ...(input.customAttributes !== undefined
      ? { customAttributes: input.customAttributes ?? Prisma.DbNull }
      : {}),
    ...(input.impactMinUrgency !== undefined ? { impactMinUrgency: input.impactMinUrgency } : {}),
    ...(input.impactMaxPriority !== undefined
      ? { impactMaxPriority: input.impactMaxPriority }
      : {}),
  };
}

/** Audit snapshot of the fields that change who is paged and what the status page says. */
function auditFields(
  input: ParsedInput,
  current?: {
    criticality: string | null;
    impactMinUrgency: string | null;
    impactMaxPriority: string | null;
    sloTarget: number | null;
    ownerUserId: string | null;
    lifecycle: string;
    quorumPartialPct: number | null;
    quorumMajorPct: number | null;
    dependencyHopDepth: number;
  }
) {
  return {
    name: input.name,
    memberServiceIds: input.memberServiceIds,
    criticality: input.criticality ?? current?.criticality ?? null,
    ownerTeamId: input.ownerTeamId,
    impactMinUrgency: input.impactMinUrgency ?? current?.impactMinUrgency ?? null,
    impactMaxPriority: input.impactMaxPriority ?? current?.impactMaxPriority ?? null,
    dependsOnBusinessServiceIds: input.dependsOnBusinessServiceIds ?? null,
    linkCount: input.links?.length ?? null,
    hasStatusPageSummary: Boolean(input.statusPageSummary),
    sloTarget: input.sloTarget ?? current?.sloTarget ?? null,
    ownerUserId: input.ownerUserId ?? current?.ownerUserId ?? null,
    lifecycle: input.lifecycle ?? current?.lifecycle ?? 'ACTIVE',
    quorumPartialPct: input.quorumPartialPct ?? current?.quorumPartialPct ?? null,
    quorumMajorPct: input.quorumMajorPct ?? current?.quorumMajorPct ?? null,
    dependencyHopDepth: input.dependencyHopDepth ?? current?.dependencyHopDepth ?? 3,
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
    await bumpRealtimeClock(tx);
    await audit(tx, context, 'business_service.created', created.id, auditFields(input));
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
      statusPageSummary: current.statusPageSummary,
      links: parseBusinessServiceLinks(current.links),
      ownerTeamId: current.ownerTeamId,
      memberServiceIds: currentMemberIds,
      followerUserIds: current.followers.map(follower => follower.user.id),
      ...raw,
    });
    await assertReferencesExist(tx, input, context.actor, {
      id,
      memberServiceIds: currentMemberIds,
      ownerTeamId: current.ownerTeamId,
      ownerUserId: current.ownerUserId,
      escalationPolicyId: current.escalationPolicyId,
    });
    if (input.dependsOnBusinessServiceIds?.includes(id))
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'A business service cannot depend on itself.',
      });
    await tx.businessService.update({ where: { id }, data: columns(input) }).catch(conflict);
    await replaceChildren(tx, id, input, currentMemberIds);
    const previousSupports = current.supportedBy.map(({ child }) => child.id).sort();
    const nextSupports = input.dependsOnBusinessServiceIds;
    await bumpRealtimeClock(tx);
    await audit(tx, context, 'business_service.updated', id, {
      ...auditFields(input, current),
      before: {
        name: current.name,
        memberServiceIds: currentMemberIds,
        criticality: current.criticality,
        ownerTeamId: current.ownerTeamId,
        impactMinUrgency: current.impactMinUrgency,
        impactMaxPriority: current.impactMaxPriority,
        sloTarget: current.sloTarget,
        ownerUserId: current.ownerUserId,
        lifecycle: current.lifecycle,
        quorumPartialPct: current.quorumPartialPct,
        quorumMajorPct: current.quorumMajorPct,
        dependencyHopDepth: current.dependencyHopDepth,
        dependsOnBusinessServiceIds: previousSupports,
        linksChanged:
          input.links !== undefined &&
          JSON.stringify(input.links ?? []) !==
            JSON.stringify(parseBusinessServiceLinks(current.links)),
        statusPageSummaryChanged:
          input.statusPageSummary !== undefined &&
          (input.statusPageSummary ?? null) !== current.statusPageSummary,
      },
      supportsChanged:
        nextSupports !== undefined &&
        JSON.stringify([...nextSupports].sort()) !== JSON.stringify(previousSupports),
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
    await bumpRealtimeClock(tx);
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
  const { incidentImpactViews } = await import('./impacts');
  const views = await incidentImpactViews(incidentId);
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
export function businessServiceDto(
  row: BusinessServiceRow,
  health?: BusinessServiceHealth | null,
  readableIncidents?: ReadonlySet<string>
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    statusPageSummary: row.statusPageSummary,
    links: parseBusinessServiceLinks(row.links),
    criticality: row.criticality,
    impactMinUrgency: row.impactMinUrgency,
    impactMaxPriority: row.impactMaxPriority,
    ownerTeam: row.ownerTeam,
    sloTarget: row.sloTarget,
    sloWindowDays: row.sloWindowDays,
    ownerUser: row.ownerUser ? { id: row.ownerUser.id, name: row.ownerUser.name } : null,
    escalationPolicy: row.escalationPolicy,
    contactChannel: row.contactChannel,
    tags: row.tags,
    environment: row.environment,
    lifecycle: row.lifecycle,
    lastReviewedAt: row.lastReviewedAt,
    customAttributes: row.customAttributes ?? null,
    quorumPartialPct: row.quorumPartialPct,
    quorumMajorPct: row.quorumMajorPct,
    dependencyHopDepth: row.dependencyHopDepth,
    members: row.members.map(({ service, critical }) => ({
      id: service.id,
      name: service.name,
      status: service.status,
      critical,
    })),
    dependsOn: row.supportedBy.map(({ child }) => child),
    followers: row.followers.map(({ user }) => ({ id: user.id, name: user.name })),
    health: health ? healthDto(health, readableIncidents) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Incident ids in reasons the reader may not see (and who marked them) are left out. */
export function healthDto(health: BusinessServiceHealth, readableIncidents?: ReadonlySet<string>) {
  return {
    status: health.status,
    since: health.since,
    reasons: health.reasons.map(reason => {
      if (!('incidentId' in reason) || readableIncidents?.has(reason.incidentId)) return reason;
      const { incidentId: _incidentId, ...rest } = reason;
      void _incidentId;
      return 'markedById' in rest ? { ...rest, markedById: null } : rest;
    }),
    openIncidentCount: health.openIncidentCount,
    memberCount: health.memberCount,
    impactedMemberCount: health.impactedMemberCount,
    computedAt: health.computedAt,
    ...(health.unknownReason ? { unknownReason: health.unknownReason } : {}),
  };
}

/** Incident ids referenced by health reasons, to resolve which the reader may see. */
export function healthIncidentIds(healths: ReadonlyArray<BusinessServiceHealth | undefined>) {
  return healths.flatMap(health =>
    (health?.reasons ?? []).flatMap(reason => ('incidentId' in reason ? [reason.incidentId] : []))
  );
}
