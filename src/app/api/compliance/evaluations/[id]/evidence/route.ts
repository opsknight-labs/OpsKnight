import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getEvaluationEvidence } from '@/lib/compliance/evidence/query';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EVIDENCE_READ);

    const { id } = await params;
    const evaluation = await prisma.complianceEvaluation.findUnique({
      where: { id },
      select: { id: true, controlId: true },
    });

    if (!evaluation) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Compliance evaluation "${id}" not found.`,
      });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const cursor = searchParams.get('cursor') ?? undefined;

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Limit must be a positive integer.',
      });
    }

    const result = await getEvaluationEvidence({
      evaluationId: id,
      limit,
      cursor,
    });

    return jsonOk({
      evaluationId: id,
      controlId: evaluation.controlId,
      evidence: result.evidence,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
