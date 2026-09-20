import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getMappingsForControl } from '@/lib/compliance/framework-mappings/registry';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertCapability(CAPABILITIES.COMPLIANCE_READ);
    const { id } = await context.params;

    const event = await prisma.complianceDriftEvent.findUnique({
      where: { id },
    });

    if (!event) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: `Compliance drift event ${id} not found.`,
        })
      );
    }

    const canReadEvidence = hasCapability(user.role, CAPABILITIES.COMPLIANCE_EVIDENCE_READ);

    // Associated evaluations
    const baselineEval = event.baselineEvaluationId
      ? await prisma.complianceEvaluation.findUnique({
          where: { id: event.baselineEvaluationId },
          select: {
            id: true,
            status: true,
            evaluatorId: true,
            evaluatorVersion: true,
            evaluatedAt: true,
            summary: true,
            findings: true,
          },
        })
      : null;

    const detectedEval = event.detectedEvaluationId
      ? await prisma.complianceEvaluation.findUnique({
          where: { id: event.detectedEvaluationId },
          select: {
            id: true,
            status: true,
            evaluatorId: true,
            evaluatorVersion: true,
            evaluatedAt: true,
            summary: true,
            findings: true,
          },
        })
      : null;

    // Associated evidence (if authorized)
    let evidence: Array<{
      id: string;
      title: string;
      type: string;
      observedAt: string;
      contentHash: string;
    }> | null = null;

    if (canReadEvidence && event.detectedEvaluationId) {
      const records = await prisma.complianceEvidence.findMany({
        where: { evaluationId: event.detectedEvaluationId },
        take: 50,
        orderBy: { observedAt: 'desc' },
      });
      evidence = records.map(r => ({
        id: r.id,
        title: r.title,
        type: r.type,
        observedAt: r.observedAt.toISOString(),
        contentHash: r.contentHash,
      }));
    }

    const mappings = event.controlId ? getMappingsForControl(event.controlId) : [];

    return jsonOk({
      ...event,
      baselineEvaluation: baselineEval,
      detectedEvaluation: detectedEval,
      evidence: canReadEvidence ? evidence : null,
      evidenceRestricted: !canReadEvidence,
      frameworkMappings: mappings,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) return jsonError(err);
    const message = err instanceof Error ? err.message : 'Failed to retrieve drift details';
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', userMessage: message }));
  }
}
