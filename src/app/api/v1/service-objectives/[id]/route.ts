import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { serviceObjectiveUpdateSchema } from '@/lib/slo/schemas';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';

const idSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/i);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentAuthorizationActor();
  const id = idSchema.parse((await params).id);
  const objective = await prisma.serviceObjective.findFirst({
    where: { id, OR: [{ serviceId: null }, { service: serviceReadWhere(actor) }] },
    include: { service: { select: { id: true, name: true } } },
  });
  return objective ? jsonOk(objective) : jsonError('Service objective not found', 404);
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
    const current = await prisma.serviceObjective.findUnique({ where: { id } });
    if (!current) return jsonError('Service objective not found', 404);

    const next = await prisma.$transaction(async tx => {
      const endedAt = new Date();
      await tx.serviceObjective.update({ where: { id }, data: { activeTo: endedAt } });
      return tx.serviceObjective.create({
        data: {
          serviceId: current.serviceId,
          name: data.name ?? current.name,
          description: data.description === undefined ? current.description : data.description,
          metricType: current.metricType,
          target: data.target ?? current.target,
          comparator: data.comparator ?? current.comparator,
          windowType: data.windowType ?? current.windowType,
          windowValue: data.windowValue === undefined ? current.windowValue : data.windowValue,
          version: current.version + 1,
          activeFrom: endedAt,
        },
        include: { service: { select: { id: true, name: true } } },
      });
    });
    return jsonOk(next);
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
    where: { id, activeTo: null },
    data: { activeTo: new Date() },
  });
  return result.count ? jsonOk({ success: true }) : jsonError('Service objective not found', 404);
}
