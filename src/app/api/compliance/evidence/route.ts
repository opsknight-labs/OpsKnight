import { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getAllEvidence } from '@/lib/compliance/evidence/query';
import {
  COMPLIANCE_EVIDENCE_TYPES,
  type ComplianceEvidenceType,
} from '@/lib/compliance/evidence/types';

export async function GET(request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EVIDENCE_READ);

    const { searchParams } = new URL(request.url);
    const controlId = searchParams.get('controlId') ?? undefined;
    const typeParam = searchParams.get('type');
    const limitParam = searchParams.get('limit');
    const cursor = searchParams.get('cursor') ?? undefined;

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

    const result = await getAllEvidence({
      controlId,
      type,
      limit,
      cursor,
    });

    return jsonOk({
      evidence: result.evidence,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
