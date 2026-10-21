import prisma from '@/lib/prisma';
import {
  defineV2Route,
  logV2Audit,
  PostmortemUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route<{ id: string }>({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  handler: async ({ actor, params }) => {
    const { id } = params;
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

    if (!postmortem) {
      throw new AppError({
        code: 'POSTMORTEM_NOT_FOUND',
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    return { data: postmortem };
  },
});

export const PATCH = defineV2Route<{ id: string }>({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  bodySchema: PostmortemUpdateV2Schema,
  handler: async ({ actor, apiKey, params, body }) => {
    const { id } = params;
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
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    let publishedAt = existing.publishedAt;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      publishedAt = new Date();
    } else if (body.status === 'DRAFT') {
      publishedAt = null;
    }

    const updated = await prisma.$transaction(async tx => {
      const rec = await tx.postmortem.update({
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
          ...(body.impact !== undefined ? { impact: body.impact } : {}),
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
        action: 'postmortem.updated',
        entityType: 'INCIDENT',
        entityId: rec.incidentId,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { changes: Object.keys(body), postmortemId: rec.id },
        tx,
      });

      return rec;
    });

    return { data: updated };
  },
});

export const DELETE = defineV2Route<{ id: string }>({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  handler: async ({ actor, apiKey, params }) => {
    const { id } = params;
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
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }

    await prisma.$transaction(async tx => {
      await tx.postmortem.delete({
        where: { id: existing.id },
      });

      await logV2Audit({
        action: 'postmortem.deleted',
        entityType: 'INCIDENT',
        entityId: existing.incidentId,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { postmortemId: existing.id },
        tx,
      });
    });

    return { status: 204 };
  },
});
