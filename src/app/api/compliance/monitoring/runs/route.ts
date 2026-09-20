import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { runComplianceEvaluationSweep } from '@/lib/compliance/monitoring/runner';

export async function POST(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EVALUATE);

    const now = new Date();

    // Create an immediate sweep run
    const run = await prisma.complianceMonitoringRun.create({
      data: {
        scheduledFor: now,
        status: 'PENDING',
      },
    });

    // Execute the sweep cycle
    const result = await runComplianceEvaluationSweep({
      monitorRunId: run.id,
      now,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err: unknown) {
    if (err instanceof AppError) return jsonError(err);
    const message =
      err instanceof Error ? err.message : 'Failed to trigger compliance monitoring run';
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', userMessage: message }));
  }
}
