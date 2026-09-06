import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { resolveUserActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';

const createSchema = z.object({
  serviceId: z.string().min(1),
  name: z.string().min(1).max(100),
  target: z.number().min(0).max(100),
  window: z.enum(['7d', '30d', '90d', 'quarterly', 'yearly']),
  metricType: z.enum(['UPTIME', 'LATENCY_P99', 'AVAILABILITY', 'MTTA', 'MTTR']),
});

export async function GET(request: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actor = await resolveUserActor(user.id);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const serviceId = searchParams.get('serviceId');

  const where = {
    ...(serviceId ? { serviceId } : {}),
    activeTo: null,
    service: serviceReadWhere(actor),
  };

  const definitions = await prisma.sLADefinition.findMany({
    where,
    include: {
      service: { select: { id: true, name: true } },
    },
    orderBy: { activeFrom: 'desc' },
  });

  return NextResponse.json(definitions);
}

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Admin access required' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    // Check if service exists
    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
    });
    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    // Deactivate any existing active SLA of same type
    await prisma.sLADefinition.updateMany({
      where: {
        serviceId: data.serviceId,
        metricType: data.metricType,
        activeTo: null,
      },
      data: { activeTo: new Date() },
    });

    // Create new SLA Definition
    const definition = await prisma.sLADefinition.create({
      data: {
        serviceId: data.serviceId,
        name: data.name,
        target: data.target,
        window: data.window,
        metricType: data.metricType,
        version: 1,
        activeFrom: new Date(),
      },
      include: {
        service: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(definition, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    logger.error('SLA Definition creation error', { error });
    return NextResponse.json({ error: 'Failed to create SLA definition' }, { status: 500 });
  }
}
