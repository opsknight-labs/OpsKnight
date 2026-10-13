import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2NoContent,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  logV2Audit,
  PostmortemUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.POSTMORTEM_READ);

    const { id } = await params;

    const accessWhere = postmortemReadWhere(actor);
    const postmortem = await prisma.postmortem.findFirst({
      where: {
        AND: [
          { OR: [{ id }, { incidentId: id }] },
          accessWhere,
        ],
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

    if (!postmortem) {
      throw new AppError({
        code: 'POSTMORTEM_NOT_FOUND',
        status: 404,
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    return apiV2Success(postmortem, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE);

    const { id } = await params;
    const body = PostmortemUpdateV2Schema.parse(await req.json());

    const accessWhere = postmortemReadWhere(actor);
    const existing = await prisma.postmortem.findFirst({
      where: {
        AND: [
          { OR: [{ id }, { incidentId: id }] },
          accessWhere,
        ],
      },
    });

    if (!existing) {
      throw new AppError({
        code: 'POSTMORTEM_NOT_FOUND',
        status: 404,
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    let publishedAt = existing.publishedAt;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      publishedAt = new Date();
    } else if (body.status === 'DRAFT') {
      publishedAt = null;
    }

    const updated = await prisma.postmortem.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.rootCause !== undefined ? { rootCause: body.rootCause } : {}),
        ...(body.resolution !== undefined
          ? { resolution: body.resolution }
          : body.mitigation !== undefined
            ? { resolution: body.mitigation }
            : {}),
        ...(body.lessons !== undefined ? { lessons: body.lessons } : {}),
        ...(body.status !== undefined ? { status: body.status, publishedAt } : {}),
        ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
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
      action: 'postmortem.updated',
      entityType: 'INCIDENT',
      entityId: updated.incidentId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { changes: Object.keys(body), postmortemId: updated.id },
    });

    return apiV2Success(updated, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE);

    const { id } = await params;

    const accessWhere = postmortemReadWhere(actor);
    const existing = await prisma.postmortem.findFirst({
      where: {
        AND: [
          { OR: [{ id }, { incidentId: id }] },
          accessWhere,
        ],
      },
    });

    if (!existing) {
      throw new AppError({
        code: 'POSTMORTEM_NOT_FOUND',
        status: 404,
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    await prisma.postmortem.delete({
      where: { id: existing.id },
    });

    await logV2Audit({
      action: 'postmortem.deleted',
      entityType: 'INCIDENT',
      entityId: existing.incidentId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { postmortemId: existing.id },
    });

    return apiV2NoContent(rlHeaders);
  } catch (error) {
    return apiV2Error(error, req);
  }
}
