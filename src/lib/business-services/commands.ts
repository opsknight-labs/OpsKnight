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

const id = z.string().trim().min(1).max(100);

export const BusinessServiceInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().default(null),
    tier: z.string().trim().max(40).nullable().default(null),
    ownerTeamId: id.nullable().default(null),
    memberServiceIds: z.array(id).max(200).default([]),
    followerUserIds: z.array(id).max(500).default([]),
  })
  .strict();

export type BusinessServiceInput = z.input<typeof BusinessServiceInputSchema>;

export const BUSINESS_SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  tier: true,
  ownerTeamId: true,
  createdAt: true,
  updatedAt: true,
  ownerTeam: { select: { id: true, name: true } },
  members: {
    orderBy: { createdAt: 'asc' },
    select: { service: { select: { id: true, name: true, status: true, teamId: true } } },
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

async function assertReferencesExist(
  tx: Prisma.TransactionClient,
  input: z.output<typeof BusinessServiceInputSchema>
) {
  const [services, users, team] = await Promise.all([
    input.memberServiceIds.length
      ? tx.service.count({ where: { id: { in: input.memberServiceIds } } })
      : 0,
    input.followerUserIds.length
      ? tx.user.count({ where: { id: { in: input.followerUserIds }, status: 'ACTIVE' } })
      : 0,
    input.ownerTeamId ? tx.team.findUnique({ where: { id: input.ownerTeamId } }) : null,
  ]);
  if (services !== new Set(input.memberServiceIds).size)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'A member service was not found.' });
  if (users !== new Set(input.followerUserIds).size)
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'A follower is not an active user.',
    });
  if (input.ownerTeamId && !team)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Owner team not found.' });
}

/**
 * Status pages show a business service through the technical services they publish, so every
 * page that maps the business service also maps its members (hidden members stay hidden).
 */
async function syncStatusPageMembers(tx: Prisma.TransactionClient, businessServiceId: string) {
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
  if (!pages.length || !members.length) return;
  await tx.statusPageService.createMany({
    data: pages.flatMap(page =>
      members.map(member => ({ statusPageId: page.statusPageId, serviceId: member.serviceId }))
    ),
    skipDuplicates: true,
  });
}

async function replaceChildren(
  tx: Prisma.TransactionClient,
  businessServiceId: string,
  input: z.output<typeof BusinessServiceInputSchema>
) {
  await tx.businessServiceMember.deleteMany({
    where: { businessServiceId, serviceId: { notIn: input.memberServiceIds } },
  });
  await tx.businessServiceMember.createMany({
    data: input.memberServiceIds.map(serviceId => ({ businessServiceId, serviceId })),
    skipDuplicates: true,
  });
  await tx.businessServiceFollower.deleteMany({
    where: { businessServiceId, userId: { notIn: input.followerUserIds } },
  });
  await tx.businessServiceFollower.createMany({
    data: input.followerUserIds.map(userId => ({ businessServiceId, userId })),
    skipDuplicates: true,
  });
  await syncStatusPageMembers(tx, businessServiceId);
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

export async function createBusinessService(
  raw: BusinessServiceInput,
  context: CommandContext,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor);
  const input = BusinessServiceInputSchema.parse(raw);
  const run = async (tx: Prisma.TransactionClient) => {
    await assertReferencesExist(tx, input);
    const created = await tx.businessService
      .create({
        data: {
          name: input.name,
          description: input.description,
          tier: input.tier,
          ownerTeamId: input.ownerTeamId,
        },
        select: { id: true },
      })
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
  return client ? run(client) : prisma.$transaction(run);
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
      where: { AND: [{ id }, businessServiceReadWhere(context.actor)] },
      select: BUSINESS_SERVICE_SELECT,
    });
    if (!current) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const input = BusinessServiceInputSchema.parse({
      name: current.name,
      description: current.description,
      tier: current.tier,
      ownerTeamId: current.ownerTeamId,
      memberServiceIds: current.members.map(member => member.service.id),
      followerUserIds: current.followers.map(follower => follower.user.id),
      ...raw,
    });
    await assertReferencesExist(tx, input);
    await tx.businessService
      .update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          tier: input.tier,
          ownerTeamId: input.ownerTeamId,
        },
      })
      .catch(conflict);
    await replaceChildren(tx, id, input);
    await audit(tx, context, 'business_service.updated', id, {
      name: input.name,
      memberServiceIds: input.memberServiceIds,
    });
    return tx.businessService.findUniqueOrThrow({ where: { id }, select: BUSINESS_SERVICE_SELECT });
  };
  return client ? run(client) : prisma.$transaction(run);
}

export async function deleteBusinessService(
  id: string,
  context: CommandContext,
  client?: Prisma.TransactionClient
) {
  assertCanManageBusinessServices(context.actor, true);
  const run = async (tx: Prisma.TransactionClient) => {
    // Pages showing it are marked dirty before the cascade removes their mapping rows.
    const removed = await tx.businessService.deleteMany({ where: { id } });
    if (!removed.count) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await audit(tx, context, 'business_service.deleted', id);
    return { id, deleted: true as const };
  };
  return client ? run(client) : prisma.$transaction(run);
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

/** Business services that contain any of the given technical services, for incident "Impacts". */
export async function businessServicesForServices(serviceIds: readonly string[]) {
  if (!serviceIds.length) return [];
  return prisma.businessService.findMany({
    where: { members: { some: { serviceId: { in: [...serviceIds] } } } },
    select: { id: true, name: true, tier: true },
    orderBy: { name: 'asc' },
  });
}

type BusinessServiceRow = Prisma.BusinessServiceGetPayload<{
  select: typeof BUSINESS_SERVICE_SELECT;
}>;

/** Public API shape: member status for at-a-glance health, follower names without emails. */
export function businessServiceDto(row: BusinessServiceRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    ownerTeam: row.ownerTeam,
    members: row.members.map(({ service }) => ({
      id: service.id,
      name: service.name,
      status: service.status,
    })),
    followers: row.followers.map(({ user }) => ({ id: user.id, name: user.name })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
