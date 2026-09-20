import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function POST(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_EVALUATE);

    const now = new Date();

    const run = await prisma.$transaction(async tx => {
      const newRun = await tx.complianceMonitoringRun.create({
        data: {
          scheduledFor: now,
          status: 'PENDING',
        },
      });

      await tx.backgroundJob.create({
        data: {
          type: 'COMPLIANCE_EVALUATION_SWEEP',
          scheduledAt: now,
          payload: { monitorRunId: newRun.id },
        },
      });

      return newRun;
    });

    return jsonOk(
      {
        monitorRunId: run.id,
        status: 'PENDING',
        scheduledFor: run.scheduledFor.toISOString(),
        message: 'Compliance monitoring sweep queued successfully',
      },
      202
    );
  } catch (err: unknown) {
    return jsonError(err);
  }
}
