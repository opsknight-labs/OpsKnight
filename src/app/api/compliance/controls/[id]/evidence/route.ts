import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getComplianceControl } from '@/lib/compliance/registry';
import { getControlEvidence } from '@/lib/compliance/evidence/query';
import {
  COMPLIANCE_EVIDENCE_TYPES,
  type ComplianceEvidenceType,
} from '@/lib/compliance/evidence/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EVIDENCE_READ);

    const { id } = await params;
    const control = getComplianceControl(id);
    if (!control) {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `Compliance control "${id}" not found.`,
      });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const cursor = searchParams.get('cursor') ?? undefined;
    const typeParam = searchParams.get('type');

    let type: ComplianceEvidenceType | undefined;
    if (typeParam) {
      if (!COMPLIANCE_EVIDENCE_TYPES.includes(typeParam as ComplianceEvidenceType)) {
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: `Invalid evidence type "${typeParam}". Must be one of: ${COMPLIANCE_EVIDENCE_TYPES.join(', ')}`,
        });
      }
      type = typeParam as ComplianceEvidenceType;
    }

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Limit must be a positive integer.',
      });
    }

    const result = await getControlEvidence({
      controlId: id,
      type,
      limit,
      cursor,
    });

    return jsonOk({
      controlId: id,
      evidence: result.evidence,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
