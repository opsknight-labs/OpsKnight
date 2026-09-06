import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { resolveUserActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  target: z.number().min(0).max(100).optional(),
  window: z.enum(['7d', '30d', '90d', 'quarterly', 'yearly']).optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actor = await resolveUserActor(user.id);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const definition = await prisma.sLADefinition.findFirst({
    where: { id, service: serviceReadWhere(actor) },
    include: {
      service: { select: { id: true, name: true } },
      snapshots: {
        orderBy: { date: 'desc' },
        take: 30, // Last 30 days of snapshots
      },
    },
  });

  if (!definition) {
    return NextResponse.json({ error: 'SLA Definition not found' }, { status: 404 });
  }

  return NextResponse.json(definition);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Admin access required' },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !/^[a-z0-9_-]{1,64}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    const existing = await prisma.sLADefinition.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'SLA Definition not found' }, { status: 404 });
    }

    // Version the update (immutable history pattern)
    // Deactivate current, create new version
    await prisma.sLADefinition.update({
      where: { id },
      data: { activeTo: new Date() },
    });

    const newDefinition = await prisma.sLADefinition.create({
      data: {
        serviceId: existing.serviceId,
        name: data.name ?? existing.name,
        target: data.target ?? existing.target,
        window: data.window ?? existing.window,
        metricType: existing.metricType,
        version: existing.version + 1,
        activeFrom: new Date(),
      },
      include: {
        service: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(newDefinition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    logger.error('SLA Definition update error', { error });
    return NextResponse.json({ error: 'Failed to update SLA definition' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await assertAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Admin access required' },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !/^[a-z0-9_-]{1,64}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
  }

  const existing = await prisma.sLADefinition.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'SLA Definition not found' }, { status: 404 });
  }

  // Soft delete by setting activeTo
  await prisma.sLADefinition.update({
    where: { id },
    data: { activeTo: new Date() },
  });

  return NextResponse.json({ success: true });
}
