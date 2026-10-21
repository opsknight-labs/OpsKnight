import prisma from '@/lib/prisma';
import {
  defineV2Route,
  logV2Audit,
  PostmortemUpdateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { etagHeaders, ifMatchWhere, parseIfMatch } from '@/lib/api-v2/concurrency';

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
        revision: true,
        incidentId: true,
        title: true,
        summary: true,
        rootCause: true,
        resolution: true,
        lessons: true,
        impact: true,
        timeline: true,
        contributingFactors: true,
        fiveWhys: true,
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

    return { data: postmortem, headers: { ...etagHeaders(postmortem.revision), 'Cache-Control': 'no-store' } };
  },
});

export const PATCH = defineV2Route<{ id: string }>({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  bodySchema: PostmortemUpdateV2Schema,
  idempotent: true,
  replayAuthGuard: async ({ actor, params, tx }) => {
    const found = await tx!.postmortem.findFirst({ where: {
      AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
    }, select: { id: true } });
    if (!found) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  },
  handler: async ({ actor, apiKey, params, body, req, tx }) => {
    const { id } = params;
    const accessWhere = postmortemReadWhere(actor);
    const db = tx ?? prisma;
    const expectedRevision = parseIfMatch(req);

    const existing = await db.postmortem.findFirst({
      where: {
        AND: [
          { OR: [{ id }, { incidentId: id }] },
          accessWhere,
        ],
      },
      include: { incident: { select: { status: true } } },
    });

    if (!existing) {
      throw new AppError({
        code: 'POSTMORTEM_NOT_FOUND',
        userMessage: `Postmortem with id '${id}' not found.`,
      });
    }
    if (body.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      if (existing.status === 'ARCHIVED' || existing.incident.status !== 'RESOLVED') {
        throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Only postmortems for resolved incidents can be published.' });
      }
      if ((body.summary ?? existing.summary ?? '').trim().length < 5) {
        throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'A postmortem summary is required before publication.' });
      }
    }

    let publishedAt = existing.publishedAt;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      publishedAt = new Date();
    } else if (body.status === 'DRAFT') {
      publishedAt = null;
    }

    const updatedCount = await db.postmortem.updateMany({
        where: { id: existing.id, ...ifMatchWhere(expectedRevision) },
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
          ...(body.timeline !== undefined ? { timeline: body.timeline } : {}),
          ...(body.contributingFactors !== undefined ? { contributingFactors: body.contributingFactors } : {}),
          ...(body.fiveWhys !== undefined ? { fiveWhys: body.fiveWhys } : {}),
          ...(body.status !== undefined ? { status: body.status, publishedAt } : {}),
          ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
        },
    });
    if (updatedCount.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const rec = await db.postmortem.findUniqueOrThrow({
        where: { id: existing.id },
        select: {
          id: true,
          revision: true,
          incidentId: true,
          title: true,
          summary: true,
          rootCause: true,
          resolution: true,
          lessons: true,
          impact: true,
          timeline: true,
          contributingFactors: true,
          fiveWhys: true,
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
        action: body.status === 'PUBLISHED' && existing.status !== 'PUBLISHED'
          ? 'postmortem.published' : 'postmortem.updated',
        entityType: 'INCIDENT',
        entityId: rec.incidentId,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { changes: Object.keys(body), postmortemId: rec.id },
        tx,
      });

    return { data: rec, headers: { ...etagHeaders(rec.revision), 'Cache-Control': 'no-store' } };
  },
});

export const DELETE = defineV2Route<{ id: string }>({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  handler: async ({ actor, apiKey, params, req }) => {
    const { id } = params;
    const accessWhere = postmortemReadWhere(actor);
    const expectedRevision = parseIfMatch(req);

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
      const deleted = await tx.postmortem.deleteMany({
        where: { id: existing.id, ...ifMatchWhere(expectedRevision) },
      });
      if (deleted.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });

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
