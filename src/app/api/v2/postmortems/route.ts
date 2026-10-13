import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  idempotencyResponseHeaders,
  logV2Audit,
  parsePaginationParams,
  PostmortemCreateV2Schema,
  PostmortemListQuerySchema,
  runV2IdempotentMutation,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.POSTMORTEM_READ);

    const { searchParams } = new URL(req.url);
    const query = PostmortemListQuerySchema.parse(Object.fromEntries(searchParams.entries()));
    const { limit, cursor } = parsePaginationParams(searchParams);

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

    const cursorWhere = buildCursorWhere(cursor);
    if (cursorWhere.OR) {
      filters.push(cursorWhere as Prisma.PostmortemWhereInput);
    }

    const where: Prisma.PostmortemWhereInput = { AND: filters };

    const postmortems = await prisma.postmortem.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        incidentId: true,
        title: true,
        summary: true,
        rootCause: true,
        resolution: true,
        lessons: true,
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

    const result = formatCursorPagination(postmortems, limit);

    return apiV2Success(result.data, {
      pagination: result.pagination,
      headers: rlHeaders,
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE);

    const body = PostmortemCreateV2Schema.parse(await req.json());

    const execution = await runV2IdempotentMutation(
      req,
      apiKey.id,
      `postmortem:create:${body.incidentId}`,
      body,
      async tx => {
        const incident = await tx.incident.findUnique({
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
            status: 404,
            userMessage: `Incident with id '${body.incidentId}' not found.`,
          });
        }

        const existing = await tx.postmortem.findUnique({
          where: { incidentId: body.incidentId },
          select: { id: true },
        });

        if (existing) {
          throw new AppError({
            code: 'POSTMORTEM_ALREADY_EXISTS',
            status: 409,
            userMessage: 'A postmortem already exists for this incident.',
          });
        }

        const title = body.title || `Postmortem: ${incident.title}`;
        const postmortem = await tx.postmortem.create({
          data: {
            incidentId: body.incidentId,
            title,
            summary: body.summary,
            rootCause: body.rootCause ?? null,
            resolution: body.resolution ?? body.mitigation ?? null,
            lessons: body.lessons ?? null,
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

        return postmortem;
      }
    );

    return apiV2Created(execution.value, {
      headers: {
        ...rlHeaders,
        ...idempotencyResponseHeaders(execution.replayed),
      },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
