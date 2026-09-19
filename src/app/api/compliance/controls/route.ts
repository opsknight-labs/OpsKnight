import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { complianceControls } from '@/lib/compliance/controls';
import { resolveComplianceRuntimeState } from '@/lib/compliance/state';

export async function GET(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const states = await prisma.complianceControlState.findMany();
    const stateMap = new Map(states.map(s => [s.controlId, s]));
    const now = new Date();

    const controls = complianceControls.map(control => {
      const resolved = resolveComplianceRuntimeState(control, stateMap.get(control.id), now);
      if (!resolved) {
        return {
          ...control,
          runtimeState: null,
        };
      }

      return {
        ...control,
        runtimeState: {
          status: resolved.status,
          latestEvaluationId: resolved.latestEvaluationId,
          evaluatorId: resolved.evaluatorId,
          evaluatorVersion: resolved.evaluatorVersion,
          evaluatedAt: resolved.evaluatedAt.toISOString(),
          validUntil: resolved.validUntil ? resolved.validUntil.toISOString() : null,
          summary: resolved.summary,
          isVersionCurrent: resolved.isVersionCurrent,
        },
      };
    });

    return jsonOk({ controls });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
