import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getComplianceControl } from '@/lib/compliance/registry';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const { id } = await params;
    const control = getComplianceControl(id);
    if (!control) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Compliance control "${id}" not found.`,
      });
    }

    const evaluations = await prisma.complianceEvaluation.findMany({
      where: { controlId: id },
      orderBy: { evaluatedAt: 'desc' },
      take: 20,
    });

    return jsonOk({
      controlId: id,
      evaluations,
    });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
