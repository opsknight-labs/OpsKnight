import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { serviceObjectiveCreateSchema, serviceObjectiveUpdateSchema } from '@/lib/slo/schemas';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';

const idSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/i);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const id = idSchema.parse((await params).id);
  const objective = await prisma.serviceObjective.findFirst({
    where: {
      lineageId: id,
      activeTo: null,
      ...serviceObjectiveReadWhere(actor),
    },
    include: { service: { select: { id: true, name: true } } },
  });
  return objective
    ? jsonOk({ ...objective, id: objective.lineageId, versionId: objective.id })
    : jsonError('Service objective not found', 404);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Admin access required', 403);
  }
  try {
    const id = idSchema.parse((await params).id);
    const data = serviceObjectiveUpdateSchema.parse(await request.json());
    const next = await prisma.$transaction(async tx => {
      const current = await tx.serviceObjective.findFirst({
        where: { lineageId: id, activeTo: null },
      });
      if (!current) return null;
      const merged = serviceObjectiveCreateSchema.parse({
        serviceId: current.serviceId,
        metricType: current.metricType,
        name: data.name ?? current.name,
        description: data.description === undefined ? current.description : data.description,
        target: data.target ?? current.target,
        comparator: data.comparator ?? current.comparator,
        windowType: data.windowType ?? current.windowType,
        windowValue: data.windowValue === undefined ? current.windowValue : data.windowValue,
      });
      const endedAt = new Date();
      const retired = await tx.serviceObjective.updateMany({
        where: { id: current.id, activeTo: null },
        data: { activeTo: endedAt },
      });
      if (retired.count !== 1) return null;
      return tx.serviceObjective.create({
        data: {
          serviceId: current.serviceId,
          lineageId: current.lineageId,
          name: merged.name,
          description: merged.description ?? null,
          metricType: current.metricType,
          target: merged.target,
          comparator: merged.comparator,
          windowType: merged.windowType,
          windowValue: merged.windowValue ?? null,
          version: current.version + 1,
          activeFrom: endedAt,
          legacySlaDefinitionId: current.legacySlaDefinitionId,
        },
        include: { service: { select: { id: true, name: true } } },
      });
    });
    if (!next) return jsonError('Active service objective not found', 409);
    return jsonOk({ ...next, id: next.lineageId, versionId: next.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError('Validation failed', 400, { details: error.errors });
    }
    logger.error('Service objective update failed', { error });
    return jsonError('Failed to update service objective', 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Admin access required', 403);
  }
  const id = idSchema.parse((await params).id);
  const result = await prisma.serviceObjective.updateMany({
    where: { lineageId: id, activeTo: null },
    data: { activeTo: new Date() },
  });
  return result.count ? jsonOk({ success: true }) : jsonError('Service objective not found', 404);
}
