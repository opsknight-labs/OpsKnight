import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const bodySchema = z
  .object({
    contributors: z
      .array(
        z
          .object({
            userId: z.string().trim().min(1).max(100),
            role: z.enum(['AUTHOR', 'REVIEWER', 'CONTRIBUTOR']),
          })
          .strict()
      )
      .max(50),
  })
  .strict()
  .refine(
    value =>
      new Set(value.contributors.map(entry => entry.userId)).size === value.contributors.length,
    'Contributor user IDs must be unique.'
  );

async function project(db: Prisma.TransactionClient, id: string) {
  const parent = await db.postmortem.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      revision: true,
      contributors: {
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        take: 51,
        select: { userId: true, role: true, user: { select: { name: true } } },
      },
    },
  });
  if (parent.contributors.length > 50) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Contributor collection exceeds the 50-person API limit.',
    });
  }
  return {
    postmortemId: parent.id,
    revision: parent.revision,
    contributors: parent.contributors.map(entry => ({
      userId: entry.userId,
      role: entry.role,
      name: entry.user.name,
    })),
  };
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const parent = await prisma.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    const result = await project(prisma, parent.id);
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const found = await tx!.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true },
    });
    if (!found) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, req, tx }) => {
    const expectedRevision = requireRevisionIfMatch(req);
    const parent = await tx!.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true, incidentId: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    await tx!.$queryRaw`SELECT "id" FROM "Postmortem" WHERE "id" = ${parent.id} FOR UPDATE`;
    const current = await tx!.postmortem.findUniqueOrThrow({
      where: { id: parent.id },
      select: { revision: true },
    });
    if (current.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const ids = body.contributors.map(entry => entry.userId);
    const users = await tx!.user.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (users.length !== ids.length)
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Every contributor must be an active user.',
      });
    await tx!.postmortemContributor.deleteMany({
      where: { postmortemId: parent.id, userId: { notIn: ids } },
    });
    for (const entry of body.contributors) {
      await tx!.postmortemContributor.upsert({
        where: { postmortemId_userId: { postmortemId: parent.id, userId: entry.userId } },
        create: { postmortemId: parent.id, userId: entry.userId, role: entry.role },
        update: { role: entry.role },
      });
    }
    await tx!.postmortem.update({ where: { id: parent.id }, data: { updatedAt: new Date() } });
    const result = await project(tx!, parent.id);
    await logV2Audit({
      action: 'postmortem.contributors.replaced',
      entityType: 'INCIDENT',
      entityId: parent.incidentId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { postmortemId: parent.id, contributorCount: result.contributors.length },
      tx,
    });
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});
