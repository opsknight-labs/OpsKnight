import { NextRequest, NextResponse } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import {
  acknowledgeComplianceDrift,
  DriftNotFoundError,
  DriftAlreadyResolvedError,
} from '@/lib/compliance/drift/acknowledge';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertCapability(CAPABILITIES.COMPLIANCE_DRIFT_MANAGE);
    const { id } = await context.params;

    const event = await acknowledgeComplianceDrift({
      driftEventId: id,
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      data: event,
    });
  } catch (err: unknown) {
    if (err instanceof DriftNotFoundError) {
      return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: err.message }));
    }
    if (err instanceof DriftAlreadyResolvedError) {
      return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: err.message }));
    }
    if (err instanceof AppError) return jsonError(err);
    const message = err instanceof Error ? err.message : 'Failed to acknowledge drift';
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', userMessage: message }));
  }
}
