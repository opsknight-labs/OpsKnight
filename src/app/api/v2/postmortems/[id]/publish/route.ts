import { z } from 'zod';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ isPublic: z.boolean() }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ actor, params, tx }) => {
    const exists = await tx!.postmortem.findFirst({ where: {
      AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
    }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  },
  handler: async ({ actor, apiKey, params, body, req, tx }) => {
    const expectedRevision = requireRevisionIfMatch(req);
    const current = await tx!.postmortem.findFirst({
      where: { AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)] },
      select: { id: true, incidentId: true, revision: true, status: true, isPublic: true,
        publishedAt: true, summary: true, incident: { select: { status: true } } },
    });
    if (!current) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    if (current.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    if (current.incident.status !== 'RESOLVED') {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Only resolved incidents can have published postmortems.' });
    }
    if (!current.summary || current.summary.trim().length < 5) {
      throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'A postmortem summary is required before publication.' });
    }
    if (current.status === 'ARCHIVED') {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Archived postmortems cannot be published.' });
    }
    if (current.status === 'PUBLISHED') {
      if (current.isPublic !== body.isPublic) {
        throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Change visibility through the revision-protected postmortem edit.' });
      }
      return { data: {
        id: current.id, revision: current.revision, status: current.status,
        isPublic: current.isPublic, publishedAt: current.publishedAt,
      }, headers: { ...etagHeaders(current.revision), 'Cache-Control': 'private, no-store' } };
    }
    const updated = await tx!.postmortem.updateMany({
      where: { id: current.id, revision: expectedRevision, status: { in: ['DRAFT', 'IN_REVIEW'] } },
      data: { status: 'PUBLISHED', isPublic: body.isPublic, publishedAt: new Date() },
    });
    if (updated.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const result = await tx!.postmortem.findUniqueOrThrow({
      where: { id: current.id }, select: {
        id: true, revision: true, status: true, isPublic: true, publishedAt: true,
      },
    });
    await logV2Audit({
      action: 'postmortem.published', entityType: 'INCIDENT', entityId: current.incidentId,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { postmortemId: current.id, isPublic: body.isPublic }, tx,
    });
    return { data: result, headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' } };
  },
});
