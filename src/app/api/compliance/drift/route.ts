import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const kindParam = searchParams.get('kind');
    const impactParam = searchParams.get('impact');
    const controlId = searchParams.get('controlId')?.trim();
    const framework = searchParams.get('framework')?.trim();
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const cursor = searchParams.get('cursor')?.trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);

    const where: Prisma.ComplianceDriftEventWhereInput = {};

    if (statusParam && statusParam !== 'ALL') {
      if (['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(statusParam)) {
        where.status = statusParam as Prisma.EnumComplianceDriftStatusFilter;
      }
    }

    if (kindParam) {
      where.kind = kindParam as never;
    }

    if (impactParam) {
      where.impact = impactParam as never;
    }

    if (controlId) {
      where.controlId = controlId;
    }

    if (framework) {
      where.framework = framework;
    }

    if (fromParam || toParam) {
      where.firstDetectedAt = {};
      if (fromParam) {
        const fromDate = new Date(fromParam);
        if (!isNaN(fromDate.getTime())) {
          where.firstDetectedAt.gte = fromDate;
        }
      }
      if (toParam) {
        const toDate = new Date(toParam);
        if (!isNaN(toDate.getTime())) {
          where.firstDetectedAt.lte = toDate;
        }
      }
    }

    const events = await prisma.complianceDriftEvent.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ firstDetectedAt: 'desc' }, { id: 'desc' }],
    });

    let nextCursor: string | null = null;
    let data = events;
    if (events.length > limit) {
      data = events.slice(0, limit);
      nextCursor = data[data.length - 1].id;
    }

    return jsonOk(data, 200, undefined, { nextCursor });
  } catch (err: unknown) {
    if (err instanceof AppError) return jsonError(err);
    const message = err instanceof Error ? err.message : 'Failed to retrieve compliance drift';
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', userMessage: message }));
  }
}
