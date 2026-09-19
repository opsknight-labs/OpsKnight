import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import { serviceObjectiveCreateSchema } from '@/lib/slo/schemas';
import { logger } from '@/lib/logger';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const actor = await getCurrentAuthorizationActor();
  const serviceId = new URL(request.url).searchParams.get('serviceId');
  const objectives = await prisma.serviceObjective.findMany({
    where: {
      activeTo: null,
      ...(serviceId ? { serviceId } : {}),
      ...serviceObjectiveReadWhere(actor),
    },
    include: { service: { select: { id: true, name: true } } },
    orderBy: { activeFrom: 'desc' },
  });
  return jsonOk(
    objectives.map(objective => ({ ...objective, id: objective.lineageId, versionId: objective.id }))
  );
}

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();
  } catch {
    return jsonError('Admin access required', 403);
  }
  try {
    const data = serviceObjectiveCreateSchema.parse(await request.json());
    if (data.serviceId) {
      const service = await prisma.service.findUnique({ where: { id: data.serviceId } });
      if (!service) return jsonError('Service not found', 404);
    }

    const objective = await prisma.$transaction(async tx => {
      const lineageId = `so_${crypto.randomUUID()}`;
      await tx.serviceObjective.updateMany({
        where: {
          serviceId: data.serviceId ?? null,
          metricType: data.metricType,
          activeTo: null,
        },
        data: { activeTo: new Date() },
      });
      return tx.serviceObjective.create({
        data: {
          id: lineageId,
          lineageId,
          serviceId: data.serviceId ?? null,
          name: data.name,
          description: data.description ?? null,
          metricType: data.metricType,
          target: data.target,
          comparator: data.comparator,
          windowType: data.windowType,
          windowValue: data.windowValue ?? null,
        },
        include: { service: { select: { id: true, name: true } } },
      });
    });
    return jsonOk({ ...objective, id: objective.lineageId, versionId: objective.id }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError('Validation failed', 400, { details: error.errors });
    }
    logger.error('Service objective creation failed', { error });
    return jsonError('Failed to create service objective', 500);
  }
}
