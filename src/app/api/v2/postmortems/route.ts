import prisma from '@/lib/prisma';
import {
  buildCursorWhere,
  defineV2Route,
  formatCursorPagination,
  logV2Audit,
  PostmortemCreateV2Schema,
  PostmortemListQuerySchema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  querySchema: PostmortemListQuerySchema,
  handler: async ({ actor, query, pagination }) => {
    const accessWhere = postmortemReadWhere(actor);
    const filters: Prisma.PostmortemWhereInput[] = [accessWhere];

    if (query.incidentId) filters.push({ incidentId: query.incidentId });
    if (query.status) filters.push({ status: query.status });
    if (query.isPublic !== undefined) filters.push({ isPublic: query.isPublic });
    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { summary: { contains: query.search, mode: 'insensitive' } },
          { rootCause: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const cursorWhere = buildCursorWhere(pagination.cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.PostmortemWhereInput);
    }

    const where: Prisma.PostmortemWhereInput = { AND: filters };

    const postmortems = await prisma.postmortem.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: {
        id: true,
        incidentId: true,
        title: true,
        summary: true,
        rootCause: true,
        resolution: true,
        lessons: true,
        impact: true,
        status: true,
        isPublic: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        incident: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            resolvedAt: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const result = formatCursorPagination(postmortems, pagination.limit);
    return { data: result.data, pagination: result.pagination };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  bodySchema: PostmortemCreateV2Schema,
  idempotent: true,
  idempotencyScope: ({ body }) => `postmortem:create:${body.incidentId}`,
  handler: async ({ body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const incident = await db.incident.findUnique({
      where: { id: body.incidentId },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${body.incidentId}' not found.`,
      });
    }

    const existing = await db.postmortem.findUnique({
      where: { incidentId: body.incidentId },
      select: { id: true },
    });

    if (existing) {
      throw new AppError({
        code: 'POSTMORTEM_ALREADY_EXISTS',
        userMessage: 'A postmortem already exists for this incident.',
      });
    }

    const title = body.title || `Postmortem: ${incident.title}`;
    const postmortem = await db.postmortem.create({
      data: {
        incidentId: body.incidentId,
        title,
        summary: body.summary,
        rootCause: body.rootCause ?? null,
        resolution: body.resolution ?? body.mitigation ?? null,
        lessons: body.lessons ?? null,
        impact: body.impact ?? undefined,
        status: body.status,
        isPublic: body.isPublic,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        createdById: actor.id,
      },
      select: {
        id: true,
        incidentId: true,
        title: true,
        summary: true,
        rootCause: true,
        resolution: true,
        lessons: true,
        impact: true,
        status: true,
        isPublic: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        incident: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await logV2Audit({
      action: 'postmortem.created',
      entityType: 'INCIDENT',
      entityId: body.incidentId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { incidentId: body.incidentId, status: postmortem.status, postmortemId: postmortem.id },
      tx,
    });

    return { status: 201, data: postmortem };
  },
});
