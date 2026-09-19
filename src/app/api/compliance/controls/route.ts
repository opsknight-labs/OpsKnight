import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { complianceControls } from '@/lib/compliance/controls';
import { getComplianceEvaluator } from '@/lib/compliance/evaluators';

export async function GET(_request: NextRequest) {
  try {
    await assertCapability(CAPABILITIES.COMPLIANCE_READ);

    const states = await prisma.complianceControlState.findMany();
    const stateMap = new Map(states.map(s => [s.controlId, s]));

    const controls = complianceControls.map(control => {
      const state = stateMap.get(control.id);
      if (!state) {
        return {
          ...control,
          runtimeState: null,
        };
      }

      const evaluator = control.evaluatorId
        ? getComplianceEvaluator(control.evaluatorId)
        : undefined;
      const isVersionCurrent = evaluator ? evaluator.version === state.evaluatorVersion : false;

      return {
        ...control,
        runtimeState: {
          status: isVersionCurrent ? state.status : 'UNVERIFIED',
          latestEvaluationId: state.latestEvaluationId,
          evaluatorId: state.evaluatorId,
          evaluatorVersion: state.evaluatorVersion,
          evaluatedAt: state.evaluatedAt.toISOString(),
          validUntil: state.validUntil ? state.validUntil.toISOString() : null,
          summary: isVersionCurrent
            ? state.summary
            : 'Evaluator version changed since last evaluation; re-evaluation required.',
          isVersionCurrent,
        },
      };
    });

    return jsonOk({ controls });
  } catch (error: unknown) {
    return jsonError(error);
  }
}
